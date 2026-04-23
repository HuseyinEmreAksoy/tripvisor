import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  const t = useTheme();
  return (
    <View style={[styles.root, { padding: t.spacing.xl, gap: t.spacing.md }]}>
      <Text style={[t.typography.title, { color: t.colors.text, textAlign: 'center' }]}>
        {title}
      </Text>
      {description ? (
        <Text
          style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center' }]}
        >
          {description}
        </Text>
      ) : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
