import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

interface ScreenProps {
  children: React.ReactNode;
  style?: ViewStyle;
  padded?: boolean;
  /**
   * Safe-area edges to pad. Default: all four. Tab-root screens pass
   * `TAB_SCREEN_EDGES` — the tab bar already owns the bottom inset.
   */
  edges?: ReadonlyArray<Edge>;
}

/** Edges for screens rendered inside the (tabs) group. */
export const TAB_SCREEN_EDGES: ReadonlyArray<Edge> = ['top', 'left', 'right'];

export function Screen({ children, style, padded = true, edges }: ScreenProps) {
  const t = useTheme();
  return (
    <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: t.colors.bg }]}>
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
