/**
 * ActionErrorBanner — inline, dismissible error row for trip-level actions
 * that fail after their sheet has already closed (e.g. Duplicate trip).
 * Renders nothing when `message` is null. Announced politely.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components';
import { useTheme } from '@/theme';

export function ActionErrorBanner({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  const t = useTheme();
  if (!message) return null;
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: t.colors.dangerLight,
          borderRadius: t.radius.md,
          marginHorizontal: t.spacing.md,
          marginTop: t.spacing.sm,
          paddingLeft: t.spacing.md,
          gap: t.spacing.sm,
        },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <Text style={[t.typography.caption, styles.text, { color: t.colors.danger, paddingVertical: t.spacing.sm }]}>{message}</Text>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss error"
        hitSlop={8}
        style={styles.close}
      >
        <Icon name="x" size={18} color={t.colors.danger} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
