/**
 * New trip screen — Redesigned with gradient banner, visual transport mode selector,
 * animated form fields, and refined layout.
 */
import { useRouter } from 'expo-router';
import { Pressable, Platform, ScrollView, Text, View, type ViewStyle } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { BackButton, Button, Heading, Screen, TextField } from '@/components';
import { DateField } from '@/components/DateField';
import { useCreateTrip } from '@/api';
import { useTheme } from '@/theme';

const Schema = z
  .object({
    title: z.string().min(1, 'Title is required').max(120),
    start_date: z.string().nullable(),
    end_date: z.string().nullable(),
    daily_hours_budget: z.number().positive().max(24),
    // Phase 23: bicycling added to match trips_transport_mode_check constraint.
    transport_mode: z.enum(['driving', 'walking', 'bicycling', 'transit']),
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
    },
    mode: 'onBlur',
  });

  const currentTransport = watch('transport_mode');

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
        ...parsed.data,
        timezone: detectedTz,
      });
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
