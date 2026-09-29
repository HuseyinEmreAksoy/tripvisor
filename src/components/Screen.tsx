import { createContext, forwardRef, useContext } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewProps, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { layout, useTheme } from '@/theme';

/**
 * Desktop column for a screen (M5 Y2.4). Desktop web is not a stretched
 * phone: forms sit in a centred ≤ 640 px column, reading screens in 960 px.
 * On phones the column is simply full width (maxWidth never binds).
 *   - `form`    — 640 px: new trip, AI plan, add place, settings-like forms;
 *   - `content` — 960 px: lists and reading screens;
 *   - `full`    — edge to edge (maps, split views). Default.
 */
export type ScreenWidth = 'form' | 'content' | 'full';

const COLUMN_MAX: Record<Exclude<ScreenWidth, 'full'>, number> = {
  form: layout.formWidth,
  content: layout.contentWidth,
};

/** The centred-column style for a width (empty for `full`). */
export function screenColumnStyle(width: ScreenWidth): ViewStyle {
  if (width === 'full') return {};
  return { width: '100%', maxWidth: COLUMN_MAX[width], alignSelf: 'center' };
}

const ScreenWidthContext = createContext<ScreenWidth>('full');

/** The enclosing `<Screen width>` — for children that build their own column. */
export function useScreenWidth(): ScreenWidth {
  return useContext(ScreenWidthContext);
}

interface ScreenProps {
  children: React.ReactNode;
  style?: ViewStyle;
  padded?: boolean;
  /**
   * Safe-area edges to pad. Default: all four. Tab-root screens pass
   * `TAB_SCREEN_EDGES` — the tab bar already owns the bottom inset.
   */
  edges?: ReadonlyArray<Edge>;
  /**
   * Desktop column (Y2.4). A `padded` (non-scrolling) screen gets the
   * column on its body. A scrolling screen renders `<ScreenScrollView>`
   * inside, which keeps the scroll surface (and scrollbar, and mouse-wheel
   * target) full width and centres only the content.
   */
  width?: ScreenWidth;
}

/** Edges for screens rendered inside the (tabs) group. */
export const TAB_SCREEN_EDGES: ReadonlyArray<Edge> = ['top', 'left', 'right'];

export function Screen({ children, style, padded = true, edges, width = 'full' }: ScreenProps) {
  const t = useTheme();
  return (
    <ScreenWidthContext.Provider value={width}>
      <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: t.colors.bg }]}>
        <View
          style={[
            styles.inner,
            padded && { padding: t.spacing.lg, gap: t.spacing.md },
            padded && screenColumnStyle(width),
            style,
          ]}
        >
          {children}
        </View>
      </SafeAreaView>
    </ScreenWidthContext.Provider>
  );
}

/**
 * A ScrollView whose CONTENT follows the enclosing `<Screen width>` column.
 * Same props as ScrollView; `contentContainerStyle` is merged after the
 * column so callers keep control of padding and gaps.
 */
export const ScreenScrollView = forwardRef<ScrollView, ScrollViewProps>(function ScreenScrollView(
  { contentContainerStyle, ...rest },
  ref,
) {
  const width = useScreenWidth();
  return (
    <ScrollView
      ref={ref}
      {...rest}
      contentContainerStyle={[screenColumnStyle(width), contentContainerStyle]}
    />
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  inner: { flex: 1 },
});
