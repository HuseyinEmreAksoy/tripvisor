/**
 * HeroValueChips — the "Plan · Optimize · Share" pill row on the auth hero
 * (login + signup). Lucide line icons instead of emoji so the glyphs follow
 * the hero chip text color on every platform.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { Icon, type IconName } from './Icon';

const CHIPS: ReadonlyArray<{ icon: IconName; label: string }> = [
  { icon: 'plane', label: 'Plan' },
  { icon: 'map', label: 'Optimize' },
  { icon: 'users', label: 'Share' },
];

export function HeroValueChips() {
  const t = useTheme();
  return (
    <View style={styles.row}>
      {CHIPS.map((chip) => (
        <View
          key={chip.label}
          style={[styles.chip, { backgroundColor: t.colors.heroChipBg, borderRadius: t.radius.pill }]}
        >
          <Icon name={chip.icon} size={14} color={t.colors.heroChipText} />
          <Text style={[t.typography.caption, { color: t.colors.heroChipText }]}>{chip.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
});
