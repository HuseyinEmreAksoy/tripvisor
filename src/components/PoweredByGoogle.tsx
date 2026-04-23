import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

/**
 * Required attribution whenever Google Places data is displayed.
 * Google ToS: renders the "Powered by Google" wordmark.
 */
export function PoweredByGoogle() {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityLabel="Powered by Google"
      style={[styles.wrapper, { paddingVertical: t.spacing.sm }]}
    >
      <Text style={[t.typography.small, { color: t.colors.attribution }]}>
        Powered by Google
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center' },
});
