import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

interface ScreenProps {
  children: React.ReactNode;
  style?: ViewStyle;
  padded?: boolean;
}

export function Screen({ children, style, padded = true }: ScreenProps) {
  const t = useTheme();
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.colors.bg }]}>
      <View
        style={[
          styles.inner,
          padded && { padding: t.spacing.lg, gap: t.spacing.md },
          style,
        ]}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inner: { flex: 1 },
});
