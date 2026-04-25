/**
 * BackButton — a standardised back affordance used on every deep screen.
 *
 * Renders a chevron-left glyph (‹) followed by an optional label.
 * Touch target is always ≥44px wide × 44px tall to meet WCAG 2.5.5.
 *
 * Usage:
 *   <BackButton onPress={() => router.back()} />
 *   <BackButton label="Trips" onPress={() => router.replace('/trips')} />
 *   <BackButton noPrint onPress={() => router.back()} />
 *
 * noPrint — when true, the button is hidden via data-no-print on web so it
 * doesn't appear in the browser print dialog. Pass for the print route only.
 */
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/theme';

export interface BackButtonProps {
  onPress: () => void;
  /** Visible label beside the chevron. Defaults to "Back". */
  label?: string;
  /** Hide this button from the browser @media print dialog (web-only). */
  noPrint?: boolean;
}

export function BackButton({ onPress, label = 'Back', noPrint = false }: BackButtonProps) {
  const t = useTheme();

  const printProps =
    noPrint && Platform.OS === 'web'
      ? // data-no-print matches the @media print { [data-no-print] { display:none } } rule.
        ({ 'data-no-print': '' } as object)
      : {};

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Go back${label !== 'Back' ? ` to ${label}` : ''}`}
      hitSlop={8}
      style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.55 : 1 }]}
      {...printProps}
    >
      {/* Chevron glyph: U+2039 SINGLE LEFT-POINTING ANGLE QUOTATION MARK.
          Renders identically on iOS, Android, and web without a font dep.
          Screen readers see accessibilityLabel on the Pressable, so this
          Text node is hidden from the a11y tree. */}
      <Text
        style={[styles.chevron, { color: t.colors.primary }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
        aria-hidden
      >
        ‹
      </Text>
      <Text style={[t.typography.body, { color: t.colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    // Minimum 44 × 44 touch target (WCAG 2.5.5).
    minHeight: 44,
    minWidth: 44,
    gap: 2,
  },
  chevron: {
    // Slightly larger than body text so the chevron sits visually centre-aligned.
    fontSize: 22,
    lineHeight: 22,
    fontWeight: '400',
  },
});
