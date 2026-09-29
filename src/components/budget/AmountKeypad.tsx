/**
 * AmountKeypad — on-screen number pad for the quick-expense flow (v2 M4 X2.4).
 *
 * Rendered on native, where the OS keyboard would cover half the sheet; the
 * amount field sets `showSoftInputOnFocus={false}` so this pad IS the input.
 * Web keeps the real keyboard (inputMode="decimal"), so the pad isn't shown there.
 *
 * M5 Y3.2: the decimal key shows the app language's separator ("," in
 * Turkish) and is disabled for zero-decimal currencies (JPY, KRW …).
 *
 * Every key is a 48pt button with its own label; a light haptic ticks per press.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { haptics } from '@/lib/haptics';
import { useT } from '@/i18n';
import { Icon } from '@/components/Icon';
import type { AmountKey } from './expenseMath';

const ROWS: AmountKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'back'],
];

export interface AmountKeypadProps {
  onKey: (key: AmountKey) => void;
  /** Glyph for the decimal key. Default '.'. */
  decimalSeparator?: '.' | ',';
  /** Hide the decimal key's action (zero-decimal currency). */
  allowDecimal?: boolean;
}

export function AmountKeypad({ onKey, decimalSeparator = '.', allowDecimal = true }: AmountKeypadProps) {
  const t = useTheme();
  const { t: tx } = useT('money');

  function keyLabel(key: AmountKey): string {
    if (key === 'back') return tx('keypad.back');
    if (key === '.') return tx('keypad.decimal');
    return key;
  }

  return (
    <View style={{ gap: t.spacing.xs }} accessibilityLabel={tx('keypad.label')}>
      {ROWS.map((row, i) => (
        <View key={i} style={[styles.row, { gap: t.spacing.xs }]}>
          {row.map((key) => {
            const disabled = key === '.' && !allowDecimal;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={keyLabel(key)}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => {
                  haptics.tap();
                  onKey(key);
                }}
                style={({ pressed }) => [
                  styles.key,
                  {
                    backgroundColor: pressed ? t.colors.gradientSubtle : t.colors.bgElevated,
                    borderColor: t.colors.border,
                    borderRadius: t.radius.md,
                    opacity: disabled ? 0.4 : 1,
                  },
                ]}
              >
                {key === 'back' ? (
                  <Icon name="delete" size={22} color={t.colors.text} />
                ) : (
                  <Text style={[t.typography.subtitle, { color: t.colors.text }]}>
                    {key === '.' ? decimalSeparator : key}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  key: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
