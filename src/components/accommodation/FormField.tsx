/**
 * FormField — caption label + control + polite inline error, for the
 * accommodation edit sheet (extracted in v2 M4 X2.4 to keep the sheet < 600 lines).
 */
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '@/theme';

export function FormField({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{label}</Text>
      {children}
      {error ? (
        <Text style={[t.typography.caption, { color: t.colors.danger }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
