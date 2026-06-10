/**
 * DocumentUploadButton — trip document picker (v2 Phase P2.3).
 *
 * WEB-ONLY surface, on purpose: file picking on iOS/Android needs a new
 * native dependency (expo-document-picker), which P2 explicitly forbids.
 * The real implementation lives in DocumentUploadButton.web.tsx (hidden
 * HTML `<input type="file">` — the CsvImportButton.web.tsx pattern, zero
 * new dependencies).
 *
 * This base file is what NATIVE resolves at runtime (and what tsc
 * type-checks for consumers): a muted one-liner pointing users at the web
 * app. VIEWING documents still works everywhere — only uploading is
 * web-gated (see DocumentsSection).
 */
import { Text } from 'react-native';
import { useTheme } from '@/theme';

export interface DocumentUploadButtonProps {
  /** Trip whose `trip-docs` folder receives the upload. */
  tripId: string;
}

export function DocumentUploadButton(_props: DocumentUploadButtonProps) {
  const t = useTheme();
  return (
    <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
      Upload documents from the web app — they'll show up here.
    </Text>
  );
}
