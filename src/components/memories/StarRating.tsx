/**
 * StarRating — the user's OWN 1–5 stars (M5 Y3.1). Never a Google rating.
 *
 * Interactive: five 44 px buttons in a radio group; pressing the current
 * value clears it (null). Read-only: a compact row with one text label.
 */
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Star } from 'lucide-react-native';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';
import { haptics } from '@/lib/haptics';

export interface StarRatingProps {
  value: number | null;
  onChange?: (next: number | null) => void;
  size?: number;
  disabled?: boolean;
}

const STARS = [1, 2, 3, 4, 5] as const;

/** Decorative star glyph (filled when on). The parent carries the a11y label. */
function StarGlyph({ on, size, color, emptyColor }: { on: boolean; size: number; color: string; emptyColor: string }) {
  // Same web/native split as Icon.tsx: RN a11y props would leak onto the DOM <svg>.
  const hidden: Record<string, unknown> =
    Platform.OS === 'web'
      ? { 'aria-hidden': true, focusable: 'false' }
      : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' };
  return (
    <Star
      size={size}
      color={on ? color : emptyColor}
      fill={on ? color : 'transparent'}
      strokeWidth={on ? 2 : 1.75}
      {...hidden}
    />
  );
}

export function StarRating({ value, onChange, size = 28, disabled = false }: StarRatingProps) {
  const t = useTheme();
  const { t: tx } = useT('memories');
  const filledColor = t.colors.warning;
  const emptyColor = t.colors.textMuted;

  if (!onChange) {
    return (
      <View
        accessible
        accessibilityLabel={value ? tx('review.starLabel', { count: value }) : tx('review.noRating')}
        style={[styles.row, { gap: 2 }]}
      >
        {STARS.map((n) => (
          <StarGlyph key={n} on={value !== null && n <= value} size={size} color={filledColor} emptyColor={emptyColor} />
        ))}
      </View>
    );
  }

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={tx('review.ratingGroup')} style={styles.row}>
      {STARS.map((n) => {
        const on = value !== null && n <= value;
        return (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityLabel={tx('review.starLabel', { count: n })}
            accessibilityState={{ checked: value === n, disabled }}
            disabled={disabled}
            hitSlop={2}
            onPress={() => {
              haptics.tap();
              onChange(value === n ? null : n);
            }}
            style={({ pressed }) => [styles.star, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}
          >
            <StarGlyph on={on} size={size} color={filledColor} emptyColor={emptyColor} />
          </Pressable>
        );
      })}
      {value !== null ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted, marginLeft: t.spacing.xs }]}>
          {tx('review.valueOfFive', { value })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  star: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
