/**
 * AmountKeypad — on-screen number pad for the quick-expense flow (v2 M4 X2.4).
 *
 * Rendered on native, where the OS keyboard would cover half the sheet; the
 * amount field sets `showSoftInputOnFocus={false}` so this pad IS the input.
 * Web keeps the real keyboard (inputMode="decimal"), so the pad isn't shown there.
 *
 * Every key is a 52pt button with its own label; a light haptic ticks per press.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { haptics } from '@/lib/haptics';
import type { AmountKey } from './expenseMath';

const ROWS: AmountKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'back'],
];

function keyLabel(key: AmountKey): string {
  if (key === 'back') return 'Delete last digit';
  if (key === '.') return 'Decimal point';
  return key;
}

export interface AmountKeypadProps {
  onKey: (key: AmountKey) => void;
}

export function AmountKeypad({ onKey }: AmountKeypadProps) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xs }} accessibilityLabel="Amount keypad">
      {ROWS.map((row, i) => (
        <View key={i} style={[styles.row, { gap: t.spacing.xs }]}>
          {row.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={keyLabel(key)}
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
                },
              ]}
            >
              <Text style={[t.typography.subtitle, { color: t.colors.text }]}>
                {key === 'back' ? '⌫' : key}
              </Text>
            </Pressable>
          ))}
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
