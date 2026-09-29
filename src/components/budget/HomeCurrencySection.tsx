/**
 * HomeCurrencySection — the trip's home currency in the settings sheet (M5 Y3.2).
 *
 * Owner-only (the server rejects editors: enforce_trips_column_restrictions);
 * everyone else sees the value read-only with a note.
 *
 * Changing it is a two-step flow:
 *   1. Pick a code (chip row + searchable "More…") → an inline confirm panel
 *      explains the re-derivation from planHomeCurrencyChange: how many
 *      expenses get re-converted with the new currency's rate ON THEIR OWN
 *      DATE, how many are already in it, how many stay pending, and that the
 *      budget converts at today's rate. Original amounts never change.
 *   2. Confirm → one trip write (currency + converted budget; no rate for the
 *      budget → nothing changes, never a mis-denominated budget), then
 *      useWarmFxForTrip fetches the past rates those expenses need. Quota /
 *      offline outcomes are reported; the summaries self-heal later.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { formatMoney, useT } from '@/i18n';
import { Button } from '@/components/Button';
import { useUpdateTrip } from '@/api';
import { fetchFxRate } from '@/api/fx';
import { useTripExpenses, useWarmFxForTrip } from '@/api/trip-expenses';
import { normalizeCurrency, planHomeCurrencyChange, type HomeChangePlan } from '@/lib/money';
import { CurrencyPicker, useCurrencyName } from './CurrencyPicker';
import { convertBudget, recentCurrencies, suggestedCurrencies } from './currencies';

/** Always offered next to the home currency and the trip's recent ones. */
const HOME_EXTRA = ['EUR', 'USD', 'TRY', 'GBP'];

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'done'; code: string; warn: 'quota' | 'offline' | 'partial' | null }
  | { kind: 'error'; reason: 'budgetRate' | 'save' };

export interface HomeCurrencySectionProps {
  tripId: string;
  /** Current home currency (`trips.currency`). */
  currency: string;
  /** `trips.total_budget` in the current home currency. */
  totalBudget?: number | null;
  isOwner: boolean;
}

export function HomeCurrencySection({ tripId, currency, totalBudget = null, isOwner }: HomeCurrencySectionProps) {
  const t = useTheme();
  const { t: tx } = useT(['money', 'trip', 'common']);
  const nameOf = useCurrencyName();
  const home = normalizeCurrency(currency) ?? 'USD';
  const updateTrip = useUpdateTrip(tripId);
  const warm = useWarmFxForTrip(tripId);
  const { data: expenses } = useTripExpenses(isOwner ? tripId : undefined);
  const [target, setTarget] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const suggestions = useMemo(
    () =>
      suggestedCurrencies({
        home,
        recent: recentCurrencies(expenses, home),
        extra: HOME_EXTRA,
        selected: target,
        max: 6,
      }),
    [home, expenses, target],
  );
  const plan: HomeChangePlan | null = useMemo(
    () => (target ? planHomeCurrencyChange(expenses ?? [], home, target) : null),
    [target, expenses, home],
  );

  if (!isOwner) {
    return (
      <View style={{ gap: t.spacing.xs }}>
        <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
          {tx('settings.homeCurrency')}
        </Text>
        <Text style={[t.typography.body, { color: t.colors.text }]}>
          {nameOf(home) === home ? home : tx('settings.codeAndName', { code: home, name: nameOf(home) })}
        </Text>
        <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('settings.ownerOnly')}</Text>
      </View>
    );
  }

  const hasBudget = totalBudget != null && totalBudget > 0;

  async function confirm() {
    if (!target || status.kind === 'saving') return;
    const code = target;
    setStatus({ kind: 'saving' });
    let budgetPatch: { total_budget: number } | Record<string, never> = {};
    if (hasBudget) {
      try {
        const { rate } = await fetchFxRate(home, code, 'latest');
        budgetPatch = { total_budget: convertBudget(totalBudget as number, rate, code) };
      } catch {
        setStatus({ kind: 'error', reason: 'budgetRate' });
        return;
      }
    }
    try {
      await updateTrip.mutateAsync({ currency: code, ...budgetPatch });
    } catch {
      setStatus({ kind: 'error', reason: 'save' });
      return;
    }
    setTarget(null);
    try {
      const report = await warm.mutateAsync({ homeCurrency: code });
      const warn = report.quotaExceeded
        ? 'quota'
        : report.offline
          ? 'offline'
          : report.failed.length > 0
            ? 'partial'
            : null;
      setStatus({ kind: 'done', code, warn });
    } catch {
      // The change itself landed; the summaries warm missing days on their own.
      setStatus({ kind: 'done', code, warn: 'partial' });
    }
  }

  return (
    <View style={{ gap: t.spacing.sm }}>
      <View style={{ gap: 2 }}>
        <Text style={[t.typography.overline, { color: t.colors.textMuted }]}>{tx('settings.homeCurrency')}</Text>
        <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('settings.homeCurrencyHint')}</Text>
      </View>
      <CurrencyPicker
        label={tx('settings.homeCurrency')}
        value={target ?? home}
        home={home}
        suggestions={suggestions}
        onChange={(code) => {
          setStatus({ kind: 'idle' });
          setTarget(code === home ? null : code);
        }}
      />

      {target && plan ? (
        <View
          accessibilityRole="alert"
          style={[
            styles.confirm,
            {
              borderColor: t.colors.primary,
              backgroundColor: t.colors.bgElevated,
              borderRadius: t.radius.md,
              padding: t.spacing.md,
              gap: t.spacing.xs,
            },
          ]}
        >
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} accessibilityRole="header" aria-level={4}>
            {tx('homeChange.title', { code: target })}
          </Text>
          <Text style={[t.typography.caption, { color: t.colors.text }]}>
            {tx('homeChange.body', { from: home, to: target })}
          </Text>
          {plan.toRederive > 0 ? (
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              {tx('homeChange.rederive', { count: plan.toRederive, to: target })}
            </Text>
          ) : null}
          {plan.alreadyInNewHome > 0 ? (
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              {tx('homeChange.alreadyHome', { count: plan.alreadyInNewHome, to: target })}
            </Text>
          ) : null}
          {plan.frozenIntoNewHome > 0 ? (
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              {tx('homeChange.keepsRate', { count: plan.frozenIntoNewHome, to: target })}
            </Text>
          ) : null}
          {plan.withoutDate > 0 ? (
            <Text style={[t.typography.caption, { color: t.colors.warningText }]}>
              {tx('homeChange.noDate', { count: plan.withoutDate })}
            </Text>
          ) : null}
          {hasBudget ? (
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              {tx('homeChange.budget', { amount: formatMoney(totalBudget as number, home), to: target })}
            </Text>
          ) : null}
          <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('homeChange.originals')}</Text>
          <View style={[styles.actions, { gap: t.spacing.sm, marginTop: t.spacing.xs }]}>
            <View style={styles.flex}>
              <Button
                label={tx('common:actions.cancel')}
                variant="ghost"
                onPress={() => {
                  setTarget(null);
                  setStatus({ kind: 'idle' });
                }}
              />
            </View>
            <View style={styles.flex}>
              <Button
                label={tx('homeChange.confirm', { code: target })}
                onPress={() => void confirm()}
                loading={status.kind === 'saving'}
              />
            </View>
          </View>
        </View>
      ) : null}

      {status.kind === 'error' ? (
        <Text accessibilityRole="alert" style={[t.typography.caption, { color: t.colors.danger }]}>
          {status.reason === 'budgetRate' ? tx('trip:settingsSheet.currencyFxFailed') : tx('homeChange.saveFailed')}
        </Text>
      ) : null}
      {status.kind === 'done' ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[t.typography.caption, { color: status.warn ? t.colors.warningText : t.colors.success }]}
        >
          {status.warn === 'quota'
            ? tx('homeChange.warmQuota', { code: status.code })
            : status.warn === 'offline'
              ? tx('homeChange.warmOffline', { code: status.code })
              : status.warn === 'partial'
                ? tx('homeChange.warmPartial', { code: status.code })
                : tx('homeChange.done', { code: status.code })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  confirm: { borderWidth: 1.5 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
