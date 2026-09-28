/**
 * DocumentUploadButton (web) — trip document upload (v2 Phase P2.3).
 *
 * A hidden HTML `<input type="file">` (the CsvImportButton.web.tsx /
 * DateField.web.tsx interop pattern — react-native-web renders DOM elements
 * directly, zero new dependencies) triggered by a styled pressable.
 *
 * Flow: pick → friendly pre-flight checks (10MB cap mirrored from
 * MAX_DOCUMENT_BYTES; bucket MIME allow-list) → `file.arrayBuffer()` →
 * useUploadTripDocument (object first, metadata row second — see
 * src/api/trip-documents.ts). Spinner while uploading; failures render as a
 * polite inline line, never an alert.
 *
 * Native resolves the base DocumentUploadButton.tsx (a muted "use the web
 * app" note) — uploads are web-only by design in P2.
 */
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { MAX_DOCUMENT_BYTES, useUploadTripDocument } from '@/api';
import { useTheme } from '@/theme';
import { Icon } from '@/components/Icon';

// Kept in lockstep with DocumentUploadButton.tsx (the native base). Redefined
// rather than imported so this file never references its own module name —
// the CsvImportButton.web.tsx convention (Metro resolves `./DocumentUploadButton`
// to THIS file on web).
export interface DocumentUploadButtonProps {
  /** Trip whose `trip-docs` folder receives the upload. */
  tripId: string;
}

/** Mirror of the trip-docs bucket allow-list (see migration 0024). */
const ALLOWED_MIMES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

const MAX_MB = Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024));

export function DocumentUploadButton({ tripId }: DocumentUploadButtonProps) {
  const t = useTheme();
  const upload = useUploadTripDocument();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    // Pre-flight the server-side caps so users get friendly errors before
    // burning upload bandwidth.
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError(`"${file.name}" is over the ${MAX_MB}MB document limit — try a smaller file.`);
      return;
    }
    if (file.type && !ALLOWED_MIMES.has(file.type)) {
      setError('Only PDF and image files (PNG, JPEG, WebP) are supported.');
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      await upload.mutateAsync({
        tripId,
        file: { name: file.name, mime: file.type || null, bytes },
      });
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'document_too_large'
          ? `That file is over the ${MAX_MB}MB document limit.`
          : "Upload failed — check your connection and try again.",
      );
    }
  };

  return (
    <View style={[styles.wrap, { gap: t.spacing.xs }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Upload a document — PDF or image, up to 10 megabytes"
        accessibilityState={{ disabled: upload.isPending, busy: upload.isPending }}
        disabled={upload.isPending}
        onPress={() => inputRef.current?.click()}
        style={({ pressed }) => [
          styles.pill,
          {
            borderColor: t.colors.border,
            backgroundColor: t.colors.bgElevated,
            borderRadius: t.radius.pill,
            paddingHorizontal: t.spacing.md,
            opacity: upload.isPending ? 0.7 : pressed ? 0.6 : 1,
            cursor: upload.isPending ? 'default' : 'pointer',
          } as ViewStyle,
        ]}
      >
        {upload.isPending ? (
          <View style={[styles.pillContent, { gap: t.spacing.xs }]}>
            <ActivityIndicator size="small" color={t.colors.primary} />
            <Text style={[t.typography.small, { color: t.colors.textMuted, fontWeight: '600' }]}>
              Uploading…
            </Text>
          </View>
        ) : (
          <View style={[styles.pillContent, { gap: t.spacing.xs }]}>
            <Icon name="upload" size={16} color={t.colors.textMuted} />
            <Text style={[t.typography.small, { color: t.colors.text, fontWeight: '600' }]}>
              Upload document
            </Text>
          </View>
        )}
      </Pressable>
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[t.typography.caption, { color: t.colors.danger }]}
        >
          {error}
        </Text>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        style={{ display: 'none' }}
        aria-hidden
        tabIndex={-1}
        onChange={(e: { target: { files?: ArrayLike<File> | null; value: string } }) => {
          const file = e.target.files?.[0];
          // Reset so re-picking the same file fires onChange again.
          e.target.value = '';
          if (file) void handleFile(file);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  pill: {
    minHeight: 44,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  pillContent: { flexDirection: 'row', alignItems: 'center' },
});
