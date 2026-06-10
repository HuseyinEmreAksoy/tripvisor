// Tripvisor v2 Phase P2 (BUILD-LOG P2.3) — trip documents client wrappers.
//
// Two-layer model (see 0024_v2_packing_documents_storage.sql):
//   - BYTES live in the private Storage bucket `trip-docs` under the path
//     convention `<trip_id>/<ts>_<safeName>`; storage.objects RLS gates them
//     by parsing the trip id out of the path (storage_path_trip_id →
//     user_can_access_trip).
//   - METADATA lives in `public.trip_documents` (one row per object) — the
//     listable index this module reads.
//
// Consistency protocol (upload): object FIRST, then the metadata row; if the
// row insert fails the object is removed again (best-effort). Worst-case
// inconsistency is therefore an ORPHANED OBJECT (invisible, cheap), never an
// orphaned row pointing at nothing. Delete is the mirror: row first (that's
// the authorization surface the user sees), then best-effort object removal.
//
// Signed URLs: 60s TTL, minted on demand via a MUTATION (not a query) — a
// 60s artifact has no business in a persisted query cache.
//
// Platforms: works identically on iOS / Android / Web. `bytes` accepts an
// ArrayBuffer (native path — e.g. expo-file-system base64 → ArrayBuffer) or
// a Blob/File (web path); `supabase.storage.upload` handles both.
//
// ToS note: documents are pure USER content — never store Google Places data
// here.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import type { Uuid } from './types';
import { tripDocumentsKeys } from './_keys';

// Re-export so consumers can import everything from `@/api`.
export { tripDocumentsKeys };

// ===========================================================================
// Types + Zod schemas (keep in lockstep with 0024_v2_packing_documents_storage.sql)
// ===========================================================================

export interface TripDocument {
  id: Uuid;
  trip_id: Uuid;
  /** User-facing display name (the original filename, pre-sanitization). */
  name: string;
  /** Object key in the trip-docs bucket: `<trip_id>/<ts>_<safeName>`. */
  storage_path: string;
  mime: string | null;
  size_bytes: number | null;
  created_at: string;
}

const tripDocumentRowSchema = z.object({
  id: z.string().uuid(),
  trip_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  storage_path: z.string().min(1),
  mime: z.string().nullable(),
  size_bytes: z.number().nullable(),
  created_at: z.string(),
});

const DOCUMENT_SELECT_FIELDS = 'id, trip_id, name, storage_path, mime, size_bytes, created_at';

const BUCKET = 'trip-docs';

/** Mirror of the bucket's server-side cap (10MB) for a friendly pre-flight error. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export interface UploadTripDocumentInput {
  tripId: Uuid;
  file: {
    /** Original filename — stored as the display `name`; sanitized for the object key. */
    name: string;
    /** MIME type; bucket allow-list: application/pdf, image/png, image/jpeg, image/webp. */
    mime?: string | null;
    /** ArrayBuffer on native (e.g. base64 → ArrayBuffer), Blob/File on web. */
    bytes: ArrayBuffer | Blob;
  };
}

export interface DeleteTripDocumentInput {
  documentId: Uuid;
  tripId: Uuid;
  /** Needed to remove the underlying object (best-effort) after the row delete. */
  storagePath: string;
}

// ===========================================================================
// Pure helpers
// ===========================================================================

/**
 * Sanitize a user filename into an object-key-safe segment:
 *   - strips any path components (defeats `../` and absolute-path games
 *     client-side; the server-side storage_path_trip_id parse is the real gate),
 *   - collapses anything outside [word, dot, dash, space, parens] to `_`,
 *   - trims to the LAST 80 chars so the extension always survives,
 *   - falls back to 'file' when nothing printable remains.
 *
 * Exported for unit tests.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .replace(/[^\w.\- ()]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const limited = cleaned.length > 80 ? cleaned.slice(-80) : cleaned;
  return limited.length > 0 ? limited : 'file';
}

function byteLengthOf(bytes: ArrayBuffer | Blob): number {
  return bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.size;
}

// ===========================================================================
// Hooks: reads
// ===========================================================================

/** Metadata rows for a trip's documents, newest first. */
export function useTripDocuments(tripId: Uuid | undefined) {
  return useQuery<TripDocument[]>({
    queryKey: tripId ? tripDocumentsKeys.forTrip(tripId) : [...tripDocumentsKeys.all, 'none'],
    enabled: Boolean(tripId),
    queryFn: async () => {
      if (!tripId) return [];
      const { data, error } = await supabase
        .from('trip_documents')
        .select(DOCUMENT_SELECT_FIELDS)
        .eq('trip_id', tripId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as TripDocument[];
    },
  });
}

// ===========================================================================
// Hooks: mutations
// ===========================================================================

/**
 * Upload a document: Storage object first, metadata row second, object
 * cleanup on row failure (see the module header for the protocol rationale).
 *
 * `upsert: false` — objects are immutable by design (the bucket has no
 * UPDATE policy); the `Date.now()` prefix makes key collisions practically
 * impossible anyway.
 */
export function useUploadTripDocument() {
  const qc = useQueryClient();
  return useMutation<TripDocument, Error, UploadTripDocumentInput>({
    mutationFn: async ({ tripId, file }) => {
      z.string().uuid().parse(tripId);
      const displayName = file.name.trim().slice(0, 200) || 'Untitled document';
      const sizeBytes = byteLengthOf(file.bytes);
      if (sizeBytes > MAX_DOCUMENT_BYTES) {
        // Pre-flight the bucket's 10MB cap so the user gets a friendly error
        // before burning upload bandwidth.
        throw new Error('document_too_large');
      }

      const storagePath = `${tripId}/${Date.now()}_${sanitizeFileName(file.name)}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file.bytes, {
          contentType: file.mime ?? 'application/octet-stream',
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data, error: insertError } = await supabase
        .from('trip_documents')
        .insert({
          trip_id: tripId,
          name: displayName,
          storage_path: storagePath,
          mime: file.mime ?? null,
          size_bytes: sizeBytes,
        })
        .select(DOCUMENT_SELECT_FIELDS)
        .single();

      if (insertError) {
        // Row failed (RLS, constraint, network) — remove the just-uploaded
        // object so we don't leak invisible bytes. Best-effort: a failure
        // here only costs storage, never correctness.
        try {
          await supabase.storage.from(BUCKET).remove([storagePath]);
        } catch {
          // swallow — see above
        }
        throw insertError;
      }

      return tripDocumentRowSchema.parse(data) as TripDocument;
    },
    onSuccess: (_row, { tripId }) => {
      qc.invalidateQueries({ queryKey: tripDocumentsKeys.forTrip(tripId) });
    },
  });
}

/**
 * Mint a short-lived (60s) signed URL for viewing/downloading a document.
 *
 * A MUTATION, not a query: the URL expires in 60s, so caching it would only
 * ever serve dead links — call `mutateAsync({ storagePath })` on each "view"
 * tap and open the result immediately. Authorization rides storage.objects
 * RLS (viewer-or-better on the path's trip).
 */
export function useTripDocumentUrl() {
  return useMutation<string, Error, { storagePath: string }>({
    mutationFn: async ({ storagePath }) => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, 60);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error('createSignedUrl returned no URL');
      return data.signedUrl;
    },
  });
}

interface DocumentsMutationContext {
  previousForTrip: TripDocument[] | undefined;
}

/**
 * Delete a document: metadata row first (the authorization surface — RLS
 * editor-gated), then best-effort object removal. An object orphaned by a
 * failed removal is invisible (no row lists it) and merely costs bytes.
 * Optimistic removal from the list with snapshot rollback.
 */
export function useDeleteTripDocument() {
  const qc = useQueryClient();
  return useMutation<
    { documentId: Uuid },
    Error,
    DeleteTripDocumentInput,
    DocumentsMutationContext
  >({
    mutationFn: async ({ documentId, storagePath }) => {
      const { error } = await supabase
        .from('trip_documents')
        .delete()
        .eq('id', documentId)
        .select('id')
        .single();
      // RLS makes a forbidden delete a 0-row DELETE; `.single()` then errors
      // — the correct "you can't delete this" surface. The object stays put.
      if (error) throw error;

      try {
        await supabase.storage.from(BUCKET).remove([storagePath]);
      } catch {
        // Best-effort — see the docstring.
      }
      return { documentId };
    },
    onMutate: async ({ documentId, tripId }) => {
      await qc.cancelQueries({ queryKey: tripDocumentsKeys.forTrip(tripId) });
      const previousForTrip = qc.getQueryData<TripDocument[]>(
        tripDocumentsKeys.forTrip(tripId),
      );
      if (previousForTrip) {
        qc.setQueryData<TripDocument[]>(
          tripDocumentsKeys.forTrip(tripId),
          previousForTrip.filter((d) => d.id !== documentId),
        );
      }
      return { previousForTrip };
    },
    onError: (_err, { tripId }, context) => {
      if (context?.previousForTrip !== undefined) {
        qc.setQueryData(tripDocumentsKeys.forTrip(tripId), context.previousForTrip);
      }
    },
    onSettled: (_res, _err, { tripId }) => {
      qc.invalidateQueries({ queryKey: tripDocumentsKeys.forTrip(tripId) });
    },
  });
}
