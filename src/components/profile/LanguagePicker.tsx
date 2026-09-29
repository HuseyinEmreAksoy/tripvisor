/**
 * LanguagePicker — Profile → Language (M5 Y1.4, ADR-0011 §3).
 *
 * Three radio cards, matching the Appearance picker: System (follows the
 * device, with the detected language as a hint) · Türkçe · English. Language
 * names are endonyms, so each is readable whatever the current language is.
 * A tap switches the whole app immediately (no restart) and persists the
 * choice; System clears the override.
 */
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { haptics } from '@/lib/haptics';
import {
  deviceLanguage,
  setLanguagePreference,
  useLanguagePreference,
  useT,
  type LanguagePreference,
} from '@/i18n';
import { Icon } from '../Icon';

const OPTIONS: ReadonlyArray<{ value: LanguagePreference; badge?: string }> = [
  { value: 'system' },
  { value: 'tr', badge: 'TR' },
  { value: 'en', badge: 'EN' },
];

export function LanguagePicker() {
  const t = useTheme();
  const { t: tx } = useT(['profile', 'common']);
  const preference = useLanguagePreference();
  const device = deviceLanguage();
  const deviceName = tx(`common:language.${device}`);

  const label = (value: LanguagePreference) =>
    value === 'system' ? tx('common:language.system') : tx(`common:language.${value}`);

  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={tx('language.groupA11y')}>
      {OPTIONS.map((opt) => {
        const active = opt.value === preference;
        const color = active ? t.colors.primaryInk : t.colors.text;
        return (
          <Pressable
            key={opt.value}
            testID={`language-${opt.value}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: active, selected: active }}
            accessibilityLabel={
              opt.value === 'system' ? tx('language.systemA11y', { language: deviceName }) : label(opt.value)
            }
            onPress={() => {
              if (active) return;
              haptics.select();
              void setLanguagePreference(opt.value);
            }}
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: active ? t.colors.gradientSubtle : t.colors.cardBgSolid,
                borderColor: active ? t.colors.primary : t.colors.border,
                borderRadius: t.radius.lg,
                ...(active ? t.shadows.glow(t.colors.glowPrimary) : t.shadows.sm(t.colors.shadowColor)),
              },
              pressed && { opacity: 0.8 },
              Platform.OS === 'web' && ({ transition: 'all 0.2s ease', cursor: 'pointer' } as ViewStyle),
            ]}
          >
            {opt.badge ? (
              <View
                style={[styles.badge, { borderColor: color, borderRadius: t.radius.sm }]}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                <Text style={[t.typography.caption, styles.badgeText, { color }]}>{opt.badge}</Text>
              </View>
            ) : (
              <Icon name="smartphone" size={24} color={color} />
            )}
            <Text
              numberOfLines={1}
              style={[t.typography.caption, { color, fontWeight: active ? '700' : '500' }]}
            >
              {label(opt.value)}
            </Text>
            {opt.value === 'system' ? (
              <Text numberOfLines={2} style={[t.typography.small, styles.center, { color: t.colors.textMuted }]}>
                {tx('language.deviceHint', { language: deviceName })}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  card: {
    flex: 1,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 6,
    gap: 6,
    minHeight: 96,
  },
  badge: {
    minWidth: 30,
    height: 24,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  center: {
    textAlign: 'center',
  },
});
