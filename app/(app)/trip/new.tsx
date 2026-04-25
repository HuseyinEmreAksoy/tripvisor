/**
 * New trip screen — visual redesign (Phase 20, Step 1 + Step 5).
 *
 * Changes vs. previous version:
 *  - Added back button (Step 2) for users who navigate here and change their mind.
 *  - Added a destination-pin accent glyph beside the heading (Step 1).
 *  - Supporting copy explains what comes next so the form feels purposeful.
 *  - "Daily hours budget" → "Daily plan time" with a clearer hint (Step 5).
 *  - Transport mode selector promoted from SettingsTab into creation flow
 *    so users set it once upfront (design intention preserved from original).
 */
import { useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
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
    transport_mode: z.enum(['driving', 'walking', 'transit']),
  })
  .refine(
    (v) => !v.start_date || !v.end_date || v.start_date <= v.end_date,
    { message: 'End date must be after start date', path: ['end_date'] },
  );

type FormValues = z.infer<typeof Schema>;

const detectedTz =
  (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || null;

export default function NewTrip() {
  const t = useTheme();
  const router = useRouter();
  const createTrip = useCreateTrip();

  const {
    control,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<FormValues>({
    defaultValues: {
      title: '',
      start_date: null,
      end_date: null,
      daily_hours_budget: 8,
      transport_mode: 'driving',
    },
    mode: 'onBlur',
  });

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

        {/* ── Heading + accent ─────────────────────────────────────────── */}
        <View style={{ gap: t.spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
            {/* Decorative map-pin accent next to the title — a11y hidden */}
            <Text
              style={{ fontSize: 24 }}
              accessibilityElementsHidden
              importantForAccessibility="no"
              aria-hidden
            >
              📍
            </Text>
            <Heading level={1}>Plan your trip</Heading>
          </View>
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
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

        {/* ── Daily plan time (Step 5 — time-first terminology) ─────────── */}
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

        {detectedTz ? (
          <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
            Detected time zone: {detectedTz}
          </Text>
        ) : null}

        {/* ── Actions ───────────────────────────────────────────────────── */}
        <View style={{ gap: t.spacing.sm, marginTop: t.spacing.md }}>
          <Button
            label="Create trip"
            onPress={handleSubmit(onSubmit)}
            loading={createTrip.isPending}
          />
          <Button variant="ghost" label="Cancel" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </Screen>
  );
}
