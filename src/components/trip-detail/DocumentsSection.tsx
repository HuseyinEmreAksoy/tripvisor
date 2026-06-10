/**
 * DocumentsSection — "🎫 Documents" block inside SettingsTab (v2 Phase P2.3).
 *
 * Lists a trip's uploaded documents (name · human size · date) from
 * useTripDocuments. Tapping a row mints a fresh 60-second signed URL via the
 * useTripDocumentUrl MUTATION (per-tap by design — a 60s artifact must never
 * sit in a query cache) and opens it with `Linking.openURL`, which
 * react-native-web maps to `window.open` — so VIEWING works on iOS, Android,
 * and web alike.
 *
 * Uploading is web-only (DocumentUploadButton platform split — no new native
 * deps in P2); native editors see a muted "use the web app" note instead.
 * Delete is editor-only and confirm-gated; the row removal is optimistic
 * (useDeleteTripDocument).
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useDeleteTripDocument, useTripDocuments, useTripDocumentUrl } from '@/api';
import type { TripDocument } from '@/api';
import { useTheme } from '@/theme';
import { confirmDestructive } from '@/lib/confirm';
import { DocumentUploadButton } from './DocumentUploadButton';

export interface DocumentsSectionProps {
  tripId: string;
  /** Editors upload + delete; viewers get the read-only (still openable) list. */
  canEdit: boolean;
}

/** 1234 → "1 KB"; null/invalid → '' (size is best-effort metadata). */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Mime → row icon. Decorative only — rows carry full spoken labels. */
function docIcon(mime: string | null): string {
  if (mime === 'application/pdf') return '📄';
  if (mime?.startsWith('image/')) return '🖼️';
  return '📎';
}

function formatDocDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function DocumentsSection({ tripId, canEdit }: DocumentsSectionProps) {
  const t = useTheme();
  const { data: documents = [], isLoading, error } = useTripDocuments(tripId);
  const mintUrl = useTripDocumentUrl();
  const deleteDoc = useDeleteTripDocument();

  /** Which row is currently minting/opening (drives its inline spinner). */
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  async function handleOpen(doc: TripDocument) {
    if (openingId !== null) return; // one mint at a time
    setOpenError(null);
    setOpeningId(doc.id);
    try {
      const url = await mintUrl.mutateAsync({ storagePath: doc.storage_path });
      // RNW maps openURL to window.open(url, '_blank'); native hands the
      // https URL to the system browser/viewer. One code path, three platforms.
      await Linking.openURL(url);
    } catch {
      setOpenError(`Couldn't open "${doc.name}" — try again.`);
    } finally {
      setOpeningId(null);
    }
  }

  async function handleDelete(doc: TripDocument) {
    const confirmed = await confirmDestructive({
      title: 'Delete document?',
      message: `Delete "${doc.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (confirmed) {
      deleteDoc.mutate({ documentId: doc.id, tripId, storagePath: doc.storage_path });
    }
  }

  return (
    <View style={{ gap: t.spacing.sm }}>
      {isLoading ? (
        <ActivityIndicator color={t.colors.primary} />
      ) : error ? (
        <Text style={[t.typography.caption, { color: t.colors.danger }]}>
          Couldn't load documents. Please try again.
        </Text>
      ) : documents.length === 0 ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          No documents yet — keep tickets, reservations, and confirmations in one place.
        </Text>
      ) : (
        documents.map((doc) => {
          const meta = [formatBytes(doc.size_bytes), formatDocDate(doc.created_at)]
            .filter(Boolean)
            .join(' · ');
          const opening = openingId === doc.id;
          return (
            <View
              key={doc.id}
              style={[
                styles.row,
                {
                  backgroundColor: t.colors.bgElevated,
                  borderColor: t.colors.border,
                  borderRadius: t.radius.md,
                  paddingHorizontal: t.spacing.md,
                  gap: t.spacing.sm,
                },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${doc.name}${meta ? `, ${meta}` : ''}`}
                accessibilityState={{ busy: opening, disabled: openingId !== null && !opening }}
                disabled={openingId !== null}
                onPress={() => void handleOpen(doc)}
                hitSlop={4}
                style={({ pressed }) => [
                  styles.openArea,
                  { gap: t.spacing.sm, opacity: pressed ? 0.6 : 1 },
                  Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
                ]}
              >
                <Text style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">
                  {docIcon(doc.mime)}
                </Text>
                <View style={styles.nameBlock}>
                  <Text
                    style={[t.typography.body, { color: t.colors.text }]}
                    numberOfLines={1}
                  >
                    {doc.name}
                  </Text>
                  {meta ? (
                    <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{meta}</Text>
                  ) : null}
                </View>
                {opening ? (
                  <ActivityIndicator size="small" color={t.colors.primary} />
                ) : (
                  <Text style={{ fontSize: 14, color: t.colors.textMuted }}>›</Text>
                )}
              </Pressable>

              {canEdit ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${doc.name}`}
                  onPress={() => void handleDelete(doc)}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.deleteBtn,
                    {
                      borderRadius: t.radius.sm,
                      backgroundColor: pressed ? t.colors.dangerLight : 'transparent',
                    },
                    Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
                  ]}
                >
                  <Text style={[t.typography.body, { color: t.colors.textMuted }]}>✕</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })
      )}

      {openError ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[t.typography.caption, { color: t.colors.danger }]}
        >
          {openError}
        </Text>
      ) : null}

      {/* Upload: real picker on web, muted "use the web app" note on native. */}
      {canEdit ? <DocumentUploadButton tripId={tripId} /> : null}

      <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
        🔒 Stored privately — only trip members can access.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    minHeight: 52,
  },
  openArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  icon: { fontSize: 18 },
  nameBlock: { flex: 1, gap: 2 },
  deleteBtn: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
