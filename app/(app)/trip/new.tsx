/**
 * New trip screen — Redesigned with gradient banner, visual transport mode selector,
 * animated form fields, and refined layout.
 *
 * Phase 25 Step 25.11: currency picker added. Defaults to USD or locale-derived
 * hint. The DB currency CHECK constraint (migration 0005) limits choices to
 * USD, EUR, GBP, TRY, JPY — we present all five.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, Platform, ScrollView, Text, View, type ViewStyle } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { BackButton, Button, Heading, Screen, TextField } from '@/components';
import { DateField } from '@/components/DateField';
import { useCreateTrip, useUpdateTrip } from '@/api';
import type { TripCurrency } from '@/api/types';
import { useTheme } from '@/theme';

// DB currency CHECK constraint limits choices to exactly these five values.
// If the constraint widens in a future migration, update this list + TripCurrency
// union in lockstep. Phase 25 Step 25.11.
const CURRENCY_OPTIONS: Array<{ value: TripCurrency; label: string }> = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'TRY', label: 'TRY — Turkish Lira' },
  { value: 'JPY', label: 'JPY — Japanese Yen' },
];

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

const Schema = z
  .object({
    title: z.string().min(1, 'Title is required').max(120),
    start_date: z.string().nullable(),
    end_date: z.string().nullable(),
    daily_hours_budget: z.number().positive().max(24),
    // Phase 23: bicycling added to match trips_transport_mode_check constraint.
    transport_mode: z.enum(['driving', 'walking', 'bicycling', 'transit']),
    // Phase 25 Step 25.11: currency picker.
    currency: z.enum(['USD', 'EUR', 'GBP', 'TRY', 'JPY']),
  })
  .refine(
    (v) => !v.start_date || !v.end_date || v.start_date <= v.end_date,
    { message: 'End date must be after start date', path: ['end_date'] },
  );

type FormValues = z.infer<typeof Schema>;

const detectedTz =
  (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || null;

// Phase 23: bicycling sits between walking and transit per spec.
const TRANSPORT_OPTIONS: Array<{ value: 'driving' | 'walking' | 'bicycling' | 'transit'; icon: string; label: string }> = [
  { value: 'driving', icon: '🚗', label: 'Drive' },
  { value: 'walking', icon: '🚶', label: 'Walk' },
  { value: 'bicycling', icon: '🚲', label: 'Bike' },
  { value: 'transit', icon: '🚆', label: 'Transit' },
];

export default function NewTrip() {
  const t = useTheme();
  const router = useRouter();
  const createTrip = useCreateTrip();
  // Phase 25 Step 25.11: after creation, patch currency if not the DB default.
  // useUpdateTrip must be called unconditionally at the top level; we use 'noop'
  // as the placeholder id and only call .mutateAsync when we have a real id.
  const [pendingCurrencyPatch, setPendingCurrencyPatch] = useState<{ tripId: string; currency: TripCurrency } | null>(null);
  const updateCurrency = useUpdateTrip(pendingCurrencyPatch?.tripId ?? 'noop');

  const {
    control,
    handleSubmit,
    formState: { errors },
    setError,
    watch,
  } = useForm<FormValues>({
    defaultValues: {
      title: '',
      start_date: null,
      end_date: null,
      daily_hours_budget: 8,
      transport_mode: 'driving' as const,
      currency: detectDefaultCurrency(),
    },
    mode: 'onBlur',
  });

  const currentTransport = watch('transport_mode');
  const currentCurrency = watch('currency');

  // Phase 25 Step 25.11: fire currency patch once we have a real trip id.
  // This useEffect runs after the state update that sets pendingCurrencyPatch,
  // at which point updateCurrency is now bound to the correct tripId.
  useEffect(() => {
    if (!pendingCurrencyPatch) return;
    updateCurrency.mutate({ currency: pendingCurrencyPatch.currency });
    setPendingCurrencyPatch(null);
    // updateCurrency reference changes each render — intentionally omitted from
    // deps to avoid infinite loop. The effect only fires when pendingCurrencyPatch
    // becomes non-null, which only happens once after trip creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCurrencyPatch]);

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
      });
      // Patch currency if it differs from the DB default ('USD').
      if (parsed.data.currency !== 'USD') {
        setPendingCurrencyPatch({ tripId: trip.id, currency: parsed.data.currency });
        // updateCurrency.mutateAsync can't be awaited here because the hook
        // is bound to `pendingCurrencyPatch?.tripId ?? 'noop'` which hasn't
        // updated yet. Navigate immediately; the useEffect below fires the patch.
      }
      router.replace(`/trip/${trip.id}`);
    } catch (err) {
      setError('title', { message: (err as Error).message });
    }
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.lg }}>
        {/* ── Back affordance ───────────────────────────────────────────── */}
        <BackButton onPress={() => router.back()} label="My trips" />

        {/* ── Gradient banner ──────────────────────────────────────────── */}
        <View
          style={{
            backgroundColor: t.colors.gradientSubtle,
            borderRadius: t.radius.xl,
            padding: t.spacing.xl,
            gap: t.spacing.sm,
            ...t.shadows.sm(t.colors.shadowColor),
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
            <Text
              style={{ fontSize: 32 }}
              accessibilityElementsHidden
              importantForAccessibility="no"
              aria-hidden
            >
              📍
            </Text>
            <Heading level={1}>Plan your trip</Heading>
          </View>
          <Text style={[t.typography.body, { color: t.colors.textMuted, lineHeight: 24 }]}>
            Give your trip a name and dates. We'll help you build the perfect day-by-day itinerary.
          </Text>
        </View>

        {/* ── Destination / title ───────────────────────────────────────── */}
        <Controller
          control={control}
          name="title"
          render={({ field: { value, onChange, onBlur } }) => (
            <TextField
              label="Destination or trip name"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="e.g. Lisbon long weekend"
              error={errors.title?.message ?? null}
            />
          )}
        />

        {/* ── Date range ────────────────────────────────────────────────── */}
        <Controller
          control={control}
          name="start_date"
          render={({ field: { value, onChange } }) => (
            <DateField
              label="Start date"
              value={value}
              onChange={onChange}
              error={errors.start_date?.message ?? null}
            />
          )}
        />

        <Controller
          control={control}
          name="end_date"
          render={({ field: { value, onChange } }) => (
            <DateField
              label="End date"
              value={value}
              onChange={onChange}
              error={errors.end_date?.message ?? null}
            />
          )}
        />

        {/* ── Daily plan time ──────────────────────────────────────────── */}
        <Controller
          control={control}
          name="daily_hours_budget"
          render={({ field: { value, onChange, onBlur } }) => (
            <TextField
              label="Daily plan time (hours)"
              value={String(value)}
              onChangeText={(s) => onChange(Number(s.replace(/[^0-9.]/g, '')) || 0)}
              onBlur={onBlur}
              keyboardType="numeric"
              inputMode="decimal"
              hint="How many hours of activities you want per day"
              error={errors.daily_hours_budget?.message ?? null}
            />
          )}
        />

        {/* ── Transport mode — visual icon selector ────────────────────── */}
        <Controller
          control={control}
          name="transport_mode"
          render={({ field: { onChange } }) => (
            <View style={{ gap: t.spacing.xs }}>
              <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
                Travel mode
              </Text>
              <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                {TRANSPORT_OPTIONS.map((opt) => {
                  const active = opt.value === currentTransport;
                  return (
                    <Pressable
                      key={opt.value}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={opt.label}
                      onPress={() => onChange(opt.value)}
                      style={({ pressed }) => [
                        {
                          flex: 1,
                          alignItems: 'center',
                          justifyContent: 'center',
                          paddingVertical: t.spacing.md,
                          gap: 4,
                          borderWidth: 2,
                          borderColor: active ? t.colors.primary : t.colors.border,
                          borderRadius: t.radius.lg,
                          backgroundColor: active ? t.colors.gradientSubtle : t.colors.cardBgSolid,
                          ...(active ? t.shadows.glow(t.colors.glowPrimary) : t.shadows.sm(t.colors.shadowColor)),
                        },
                        pressed && { opacity: 0.8 },
                        Platform.OS === 'web' && ({
                          transition: 'all 0.2s ease',
                          cursor: 'pointer',
                        } as ViewStyle),
                      ]}
                    >
                      <Text style={{ fontSize: 28 }}>{opt.icon}</Text>
                      <Text
                        style={[
                          t.typography.caption,
                          {
                            color: active ? t.colors.primary : t.colors.text,
                            fontWeight: active ? '700' : '500',
                          },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        />

        {/* ── Currency picker (Phase 25 Step 25.11) ────────────────────── */}
        <Controller
          control={control}
          name="currency"
          render={({ field: { onChange } }) => (
            <View style={{ gap: t.spacing.xs }}>
              <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
                Currency
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                {CURRENCY_OPTIONS.map((opt) => {
                  const active = opt.value === currentCurrency;
                  return (
                    <Pressable
                      key={opt.value}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={opt.label}
                      onPress={() => onChange(opt.value)}
                      style={({ pressed }) => [
                        {
                          paddingHorizontal: t.spacing.md,
                          paddingVertical: t.spacing.sm,
                          borderWidth: 2,
                          borderColor: active ? t.colors.primary : t.colors.border,
                          borderRadius: t.radius.lg,
                          backgroundColor: active ? t.colors.gradientSubtle : t.colors.cardBgSolid,
                          ...(active ? t.shadows.glow(t.colors.glowPrimary) : t.shadows.sm(t.colors.shadowColor)),
                        },
                        pressed && { opacity: 0.8 },
                        Platform.OS === 'web' && ({
                          transition: 'all 0.15s ease',
                          cursor: 'pointer',
                        } as ViewStyle),
                      ]}
                    >
                      <Text
                        style={[
                          t.typography.caption,
                          {
                            color: active ? t.colors.primary : t.colors.text,
                            fontWeight: active ? '700' : '500',
                          },
                        ]}
                      >
                        {opt.value}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        />

        {detectedTz ? (
          <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
            🌍 Detected time zone: {detectedTz}
          </Text>
        ) : null}

        {/* ── Actions ───────────────────────────────────────────────────── */}
        <View style={{ gap: t.spacing.sm, marginTop: t.spacing.md }}>
          <Button
            label="🚀 Create trip"
            onPress={handleSubmit(onSubmit)}
            loading={createTrip.isPending}
          />
          <Button variant="ghost" label="Cancel" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </Screen>
  );
}
