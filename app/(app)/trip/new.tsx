/**
 * New trip screen.
 *
 * M5 Y2.4: a centred 640 px form column on desktop (`Screen width="form"` +
 * `ScreenScrollView`; it was full-bleed), a slim cover-art banner, the fields
 * grouped on one light card ("Where & when", "How you travel"), start/end
 * dates side by side when the column is wide enough, the shared
 * TransportModeRadio, and every string translated (`trip:new.*`).
 *
 * Phase 25 Step 25.11: currency picker. Defaults to a locale-derived hint.
 * The DB currency CHECK constraint (migration 0005) limits choices to
 * USD, EUR, GBP, TRY, JPY — all five are offered (Y3.2 widens the list).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeBack } from '@/hooks/useSafeBack';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  BackButton,
  Button,
  Icon,
  KeyboardAvoid,
  Screen,
  ScreenScrollView,
  TextField,
} from '@/components';
import { DateField } from '@/components/DateField';
import { TransportModeRadio } from '@/components/ai-plan/TransportModeRadio';
import { useCreateTrip } from '@/api';
import { useUserPreferences } from '@/api/preferences';
import type { TripCurrency } from '@/api/types';
import { surfaceStyle, useTheme } from '@/theme';
import { useT } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { normalizeCurrency } from '@/lib/money';
import { CurrencyPicker, useCurrencyName } from '@/components/budget/CurrencyPicker';
import { suggestedCurrencies } from '@/components/budget/currencies';

const BANNER_ART = require('../../../assets/images/cover-7.jpg');

// M5 Y3.2: any ISO 4217 code (DB CHECK ^[A-Z]{3}$). These are always offered
// as chips next to the preferred / detected one; "More…" searches the rest.
const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'TRY', 'JPY'] as const satisfies readonly TripCurrency[];

const CURRENCY_NAME_KEYS = {
  USD: 'new.currencies.USD',
  EUR: 'new.currencies.EUR',
  GBP: 'new.currencies.GBP',
  TRY: 'new.currencies.TRY',
  JPY: 'new.currencies.JPY',
} as const;

// Derive a default currency hint from the device locale.
// Falls back to 'USD' when Intl is unavailable or the derived code is not
// in our allowed set.
function detectDefaultCurrency(): TripCurrency {
  try {
    if (typeof Intl === 'undefined') return 'USD';
    const locale = Intl.NumberFormat().resolvedOptions().locale;
    // Map common locale regions to currencies.
    const regionMap: Record<string, TripCurrency> = {
      US: 'USD',
      GB: 'GBP',
      TR: 'TRY',
      JP: 'JPY',
      DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR',
      BE: 'EUR', AT: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR',
      IE: 'EUR', LU: 'EUR', SK: 'EUR', SI: 'EUR', CY: 'EUR',
      EE: 'EUR', LT: 'EUR', LV: 'EUR', MT: 'EUR',
    };
    const region = locale.split('-')[1]?.toUpperCase() ?? '';
    return regionMap[region] ?? 'USD';
  } catch {
    return 'USD';
  }
}

/** Validation messages are error CODES; the screen translates them. */
const ERROR_KEYS = {
  titleRequired: 'new.errors.titleRequired',
  titleTooLong: 'new.errors.titleTooLong',
  hoursRange: 'new.errors.hoursRange',
  endBeforeStart: 'new.errors.endBeforeStart',
  createFailed: 'new.errors.createFailed',
} as const;
type ErrorCode = keyof typeof ERROR_KEYS;

const Schema = z
  .object({
    title: z.string().trim().min(1, 'titleRequired').max(120, 'titleTooLong'),
    start_date: z.string().nullable(),
    end_date: z.string().nullable(),
    daily_hours_budget: z.number().positive('hoursRange').max(24, 'hoursRange'),
    // Phase 23: bicycling added to match trips_transport_mode_check constraint.
    transport_mode: z.enum(['driving', 'walking', 'bicycling', 'transit']),
    // M5 Y3.2: any ISO 4217 code (was a 5-code enum).
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .refine(
    (v) => !v.start_date || !v.end_date || v.start_date <= v.end_date,
    { message: 'endBeforeStart', path: ['end_date'] },
  );

type FormValues = z.infer<typeof Schema>;

const detectedTz =
  (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || null;

/** Locale-tolerant hours parse: "1,5" and "1.5" → 1.5; junk → 0. */
export function parseHours(raw: string): number {
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export default function NewTrip() {
  const t = useTheme();
  const { t: tx } = useT(['trip', 'common']);
  const router = useRouter();
  const goBack = useSafeBack('/trips');
  const createTrip = useCreateTrip();
  // M5 Y3.2: the home currency defaults to the Profile preference
  // (user_preferences.home_currency), else a device-locale guess.
  const prefs = useUserPreferences();
  const preferredCurrency = normalizeCurrency(prefs.data?.home_currency);
  const detectedCurrency = useMemo(() => detectDefaultCurrency(), []);
  const currencyTouched = useRef(false);
  const currencyName = useCurrencyName();

  const {
    control,
    handleSubmit,
    formState: { errors },
    setError,
    setValue,
    watch,
  } = useForm<FormValues>({
    defaultValues: {
      title: '',
      start_date: null,
      end_date: null,
      daily_hours_budget: 8,
      transport_mode: 'driving' as const,
      currency: preferredCurrency ?? detectedCurrency,
    },
    mode: 'onBlur',
  });

  const currentCurrency = watch('currency');
  // Raw daily-hours text while the field is being edited (null = show value).
  const [hoursText, setHoursText] = useState<string | null>(null);

  /** An error code from validation / submit → translated text (else null). */
  const errorText = (message: string | undefined): string | null => {
    if (!message) return null;
    const key = ERROR_KEYS[message as ErrorCode];
    return key ? tx(key) : message;
  };

  // Preferences can load after the first render: adopt the preferred home
  // currency unless the user already picked one.
  useEffect(() => {
    if (preferredCurrency && !currencyTouched.current) setValue('currency', preferredCurrency);
  }, [preferredCurrency, setValue]);

  const currencySuggestions = useMemo(
    () =>
      suggestedCurrencies({
        home: preferredCurrency ?? detectedCurrency,
        recent: [detectedCurrency],
        extra: CURRENCY_OPTIONS,
        selected: currentCurrency,
        max: 6,
      }),
    [preferredCurrency, detectedCurrency, currentCurrency],
  );
  // The five legacy codes keep their trip-namespace names; others use money:currencyNames.
  const nameOf = (code: string): string =>
    code in CURRENCY_NAME_KEYS ? tx(CURRENCY_NAME_KEYS[code as keyof typeof CURRENCY_NAME_KEYS]) : currencyName(code);

  const onSubmit = async (values: FormValues) => {
    const parsed = Schema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        setError(issue.path[0] as keyof FormValues, { message: issue.message });
      }
      return;
    }
    try {
      const trip = await createTrip.mutateAsync({
        title: parsed.data.title,
        start_date: parsed.data.start_date,
        end_date: parsed.data.end_date,
        daily_hours_budget: parsed.data.daily_hours_budget,
        transport_mode: parsed.data.transport_mode,
        timezone: detectedTz,
        // M5 Y3.2: created with its home currency in one write (was a follow-up patch).
        currency: parsed.data.currency,
      });
      router.replace(`/trip/${trip.id}`);
    } catch {
      haptics.error();
      setError('title', { message: 'createFailed' });
    }
  };

  const sectionLabel = [t.typography.subtitle, { color: t.colors.text }];

  return (
    <Screen padded={false} width="form">
      <KeyboardAvoid>
        <ScreenScrollView
          contentContainerStyle={{ padding: t.layout.gutter, gap: t.spacing.lg, paddingBottom: t.spacing.xxxl }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Back affordance ───────────────────────────────────────────── */}
          <BackButton onPress={goBack} label={tx('new.back')} />

          {/* ── Cover-art banner (decorative image, real heading) ──────────── */}
          <View style={[styles.banner, { borderRadius: t.radius.xl, backgroundColor: t.colors.bgMuted }]}>
            <Image
              source={BANNER_ART}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              accessibilityElementsHidden
              importantForAccessibility="no"
              aria-hidden
            />
            {/* Scrim: the photo shows at the top; from mid-height down the
                white copy sits on ≥ heroScrim-strength shade (AA). */}
            <LinearGradient
              colors={[t.colors.heroScrimSoft, t.colors.heroScrim]}
              locations={[0, 0.55]}
              style={StyleSheet.absoluteFill}
            />
            <View style={{ padding: t.spacing.xl, gap: t.spacing.xs }}>
              <Text style={[t.typography.overline, { color: t.colors.heroChipText }]}>{tx('new.overline')}</Text>
              <Text
                accessibilityRole="header"
                aria-level={1}
                style={[t.typography.title, { color: t.colors.heroChipText }]}
              >
                {tx('new.title')}
              </Text>
              <Text style={[t.typography.body, { color: t.colors.heroChipText }]}>{tx('new.subtitle')}</Text>
            </View>
          </View>

          {/* ── Where & when ─────────────────────────────────────────────── */}
          <View style={[surfaceStyle(t, 'raised'), { padding: t.layout.cardPadding, gap: t.spacing.md }]}>
            <Text style={sectionLabel} accessibilityRole="header" aria-level={2}>
              {tx('new.sections.where')}
            </Text>
            <Controller
              control={control}
              name="title"
              render={({ field: { value, onChange, onBlur } }) => (
                <TextField
                  label={tx('new.fields.title')}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  placeholder={tx('new.fields.titlePlaceholder')}
                  error={errorText(errors.title?.message)}
                />
              )}
            />
            <View style={[styles.dateRow, { gap: t.spacing.md }]}>
              <View style={styles.dateCell}>
                <Controller
                  control={control}
                  name="start_date"
                  render={({ field: { value, onChange } }) => (
                    <DateField
                      label={tx('new.fields.start')}
                      value={value}
                      onChange={onChange}
                      error={errorText(errors.start_date?.message)}
                    />
                  )}
                />
              </View>
              <View style={styles.dateCell}>
                <Controller
                  control={control}
                  name="end_date"
                  render={({ field: { value, onChange } }) => (
                    <DateField
                      label={tx('new.fields.end')}
                      value={value}
                      onChange={onChange}
                      error={errorText(errors.end_date?.message)}
                    />
                  )}
                />
              </View>
            </View>
          </View>

          {/* ── How you travel ───────────────────────────────────────────── */}
          <View style={[surfaceStyle(t, 'raised'), { padding: t.layout.cardPadding, gap: t.spacing.md }]}>
            <Text style={sectionLabel} accessibilityRole="header" aria-level={2}>
              {tx('new.sections.how')}
            </Text>
            <Controller
              control={control}
              name="daily_hours_budget"
              render={({ field: { value, onChange, onBlur } }) => (
                <TextField
                  label={tx('new.fields.hours')}
                  value={hoursText ?? String(value)}
                  onChangeText={(s) => {
                    // F3 fix: keep the raw text (a trailing "." or "," survives
                    // re-render) and accept the Turkish decimal comma — "1,5"
                    // is 1.5 hours, not 15.
                    const raw = s.replace(/[^0-9.,]/g, '');
                    setHoursText(raw);
                    onChange(parseHours(raw));
                  }}
                  onBlur={() => {
                    setHoursText(null);
                    onBlur();
                  }}
                  keyboardType="numeric"
                  inputMode="decimal"
                  hint={tx('new.fields.hoursHint')}
                  error={errorText(errors.daily_hours_budget?.message)}
                />
              )}
            />

            <Controller
              control={control}
              name="transport_mode"
              render={({ field: { value, onChange } }) => (
                <TransportModeRadio value={value} onChange={onChange} />
              )}
            />

            {/* ── Currency picker (Phase 25 Step 25.11) ──────────────────── */}
            <Controller
              control={control}
              name="currency"
              render={({ field: { onChange, value } }) => (
                <CurrencyPicker
                  label={tx('new.fields.currency')}
                  showLabel
                  value={value}
                  suggestions={currencySuggestions}
                  nameOf={nameOf}
                  optionA11y={(code, name) => tx('new.currencyA11y', { code, name })}
                  onChange={(code) => {
                    currencyTouched.current = true;
                    onChange(code);
                  }}
                />
              )}
            />

            {detectedTz ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs }}>
                <Icon name="globe" size={14} color={t.colors.textMuted} />
                <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                  {tx('new.timezone', { tz: detectedTz })}
                </Text>
              </View>
            ) : null}
          </View>

          {/* ── Actions ───────────────────────────────────────────────────── */}
          <View style={{ gap: t.spacing.sm }}>
            <Button
              label={tx('new.create')}
              onPress={handleSubmit(onSubmit)}
              loading={createTrip.isPending}
            />
            <Button variant="ghost" label={tx('common:actions.cancel')} onPress={goBack} />
          </View>
        </ScreenScrollView>
      </KeyboardAvoid>
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { overflow: 'hidden', minHeight: 148, justifyContent: 'flex-end' },
  // Start/end side by side once the column is wide enough (≥ ~520 px).
  dateRow: { flexDirection: 'row', flexWrap: 'wrap' },
  dateCell: { flexGrow: 1, flexBasis: 240 },
});
