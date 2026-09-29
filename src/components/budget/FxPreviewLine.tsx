/**
 * FxPreviewLine — the live "≈ ₺1.234,50" under the expense amount (M5 Y3.2).
 *
 * Reads useExpenseFxPreview, which fills the SAME cache entry the save uses,
 * so the previewed rate is the one that gets frozen. Offline with nothing
 * cached, it explains that the expense will be saved as "rate pending" and
 * converted later — never a 1:1 guess.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { formatDate, formatMoney, formatNumber, useT } from '@/i18n';
import { useExpenseFxPreview } from '@/api/expense-fx';

export interface FxPreviewLineProps {
  /** Parsed amount (exact string or number), null while empty/invalid. */
  amount: number | string | null;
  currency: string;
  home: string | null | undefined;
  tripStartDate?: string | null;
  dayIndex?: number | null;
}

export function FxPreviewLine({ amount, currency, home, tripStartDate, dayIndex }: FxPreviewLineProps) {
  const t = useTheme();
  const { t: tx } = useT('money');
  const preview = useExpenseFxPreview({ amount, currency, home, tripStartDate, dayIndex });

  if (!home || preview.sameCurrency || currency.toUpperCase() === home.toUpperCase()) return null;

  let main: string | null = null;
  let tone: 'muted' | 'warn' = 'muted';
  if (preview.unavailable) {
    main = tx('preview.unavailable');
    tone = 'warn';
  } else if (preview.isLoading && preview.rate === null) {
    main = tx('preview.loading');
  } else if (preview.converted) {
    main = tx('preview.converted', { amount: formatMoney(preview.converted.value, preview.converted.currency) });
  }

  const rateLine =
    preview.rate !== null
      ? tx('preview.rate', {
          from: currency.toUpperCase(),
          to: home.toUpperCase(),
          rate: formatNumber(preview.rate, { maximumFractionDigits: preview.rate < 1 ? 6 : 4 }),
          date: preview.rateDate ? formatDate(preview.rateDate, 'short') : '',
        })
      : null;

  if (!main && !rateLine) return null;

  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite" nativeID="expense-fx-preview">
      {main ? (
        <Text
          style={[
            t.typography.bodyStrong,
            tone === 'warn'
              ? { color: t.colors.warningText, backgroundColor: t.colors.warningLight, paddingHorizontal: t.spacing.sm, paddingVertical: t.spacing.xs, borderRadius: t.radius.sm }
              : { color: t.colors.primaryInk },
          ]}
        >
          {main}
        </Text>
      ) : null}
      {rateLine && !preview.unavailable ? (
        <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{rateLine}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
});
