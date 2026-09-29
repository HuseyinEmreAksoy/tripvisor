/**
 * Profile → Travel preferences (M5 Y3.4): interests (Discover's starting
 * chips), the default home currency for new trips, and the language mirror
 * (the Language picker above writes the device choice; this section mounts
 * `useLanguagePreferenceMirror` so the choice is saved to the account and a
 * new device adopts it). All writes go through `useUpdateUserPreferences`
 * (optimistic, rolled back on error).
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { surfaceStyle, useTheme } from '@/theme';
import { useT } from '@/i18n';
import { Icon } from '@/components/Icon';
import { TextField } from '@/components/TextField';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
import { haptics } from '@/lib/haptics';
import { useFxCurrencies } from '@/api/fx';
import { useLanguagePreferenceMirror, useUpdateUserPreferences, useUserPreferences } from '@/api/preferences';
import { normalizeCurrency } from '@/lib/money';
import { InterestChips } from './InterestChips';
import { normalizeInterests, type Interest } from './discoverModel';
import { useAdoptPendingInterests } from './useAdoptPendingInterests';

/** Shown as chips; everything else is one search away. */
export const POPULAR_CURRENCIES = ['TRY', 'EUR', 'USD', 'GBP', 'JPY', 'CHF'] as const;
/** Offline / before the fx list loads: the ECB reference set. */
const FALLBACK_CURRENCIES = [
  'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR',
  'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
];
const MAX_MATCHES = 12;

export function PreferencesSection() {
  const t = useTheme();
  const { t: tx } = useT(['discover']);
  useLanguagePreferenceMirror();
  useAdoptPendingInterests();
  const prefs = useUserPreferences();
  const update = useUpdateUserPreferences();
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState('');
  const fx = useFxCurrencies({ enabled: moreOpen });

  const interests = normalizeInterests(prefs.data?.interests);
  const home = prefs.data?.home_currency ?? null;

  const allCodes = useMemo(() => {
    const list = fx.data?.currencies.map((c) => c.code) ?? FALLBACK_CURRENCIES;
    return [...new Set(list)].sort();
  }, [fx.data]);
  const q = query.trim().toUpperCase();
  const matches = q ? allCodes.filter((c) => c.includes(q)).slice(0, MAX_MATCHES) : [];

  const chipCodes: string[] = [...POPULAR_CURRENCIES];
  if (home && !chipCodes.includes(home)) chipCodes.unshift(home);

  const saveInterests = (next: Interest[]) => update.mutate({ interests: next });
  const saveCurrency = (code: string | null) => {
    const normalized = code === null ? null : normalizeCurrency(code);
    if (code !== null && !normalized) return;
    haptics.select();
    update.mutate({ home_currency: normalized });
    setMoreOpen(false);
    setQuery('');
  };

  const card = [surfaceStyle(t, 'raised'), { padding: t.spacing.lg, gap: t.spacing.md }];

  if (prefs.isLoading) {
    return (
      <SkeletonGroup label={tx('prefs.loading')} style={card}>
        <Skeleton width="40%" height={16} />
        <Skeleton height={44} />
        <Skeleton width="40%" height={16} />
        <Skeleton height={44} />
      </SkeletonGroup>
    );
  }

  return (
    <View style={card} testID="preferences-section">
      <View style={{ gap: t.spacing.xs }}>
        <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>{tx('prefs.interestsTitle')}</Text>
        <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('prefs.interestsHint')}</Text>
      </View>
      <InterestChips value={interests} onChange={saveInterests} />

      <View style={[styles.divider, { backgroundColor: t.colors.border }]} />

      <View style={{ gap: t.spacing.xs }}>
        <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>{tx('prefs.currencyTitle')}</Text>
        <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('prefs.currencyHint')}</Text>
      </View>
      <View
        style={[styles.wrap, { gap: t.spacing.sm }]}
        accessibilityRole="radiogroup"
        accessibilityLabel={tx('prefs.currencyGroupA11y')}
      >
        <CurrencyChip label={tx('prefs.currencyNone')} active={home === null} onPress={() => saveCurrency(null)} />
        {chipCodes.map((code) => (
          <CurrencyChip key={code} label={code} active={home === code} onPress={() => saveCurrency(code)} />
        ))}
        <CurrencyChip label={tx('prefs.currencyMore')} active={false} onPress={() => setMoreOpen((o) => !o)} role="button" />
      </View>
      {moreOpen ? (
        <View style={{ gap: t.spacing.sm }}>
          <TextField
            label={tx('prefs.currencySearch')}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={3}
            accessibilityLabel={tx('prefs.currencySearchA11y')}
          />
          {q && matches.length === 0 ? (
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
              {tx('prefs.currencyNoMatch', { query: q })}
            </Text>
          ) : null}
          <View style={[styles.wrap, { gap: t.spacing.sm }]}>
            {matches.map((code) => (
              <CurrencyChip key={code} label={code} active={home === code} onPress={() => saveCurrency(code)} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={[styles.divider, { backgroundColor: t.colors.border }]} />
      <View style={[styles.row, { gap: t.spacing.sm }]}>
        <Icon name="globe" size={16} color={t.colors.textMuted} />
        <Text style={[t.typography.small, styles.flex, { color: t.colors.textMuted }]}>{tx('prefs.languageSynced')}</Text>
      </View>

      {update.isError ? (
        <Text
          style={[t.typography.small, { color: t.colors.danger }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {tx('prefs.saveError')}
        </Text>
      ) : null}
    </View>
  );
}

function CurrencyChip({
  label,
  active,
  onPress,
  role = 'radio',
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  role?: 'radio' | 'button';
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={role === 'radio' ? { checked: active, selected: active } : undefined}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          paddingHorizontal: t.spacing.md,
          borderRadius: t.radius.pill,
          backgroundColor: active ? t.colors.primary : t.colors.bgMuted,
        },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={[t.typography.caption, { color: active ? t.colors.primaryText : t.colors.text, fontWeight: active ? '700' : '500' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  chip: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  divider: { height: 1 },
});
