import { useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Heading, Screen, TextField } from '@/components';
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
        <Heading level={1}>New trip</Heading>

        <Controller
          control={control}
          name="title"
          render={({ field: { value, onChange, onBlur } }) => (
            <TextField
              label="Title"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="e.g. Lisbon 3 days"
              error={errors.title?.message ?? null}
            />
          )}
        />

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

        <Controller
          control={control}
          name="daily_hours_budget"
          render={({ field: { value, onChange, onBlur } }) => (
            <TextField
              label="Daily hours budget"
              value={String(value)}
              onChangeText={(s) => onChange(Number(s.replace(/[^0-9.]/g, '')) || 0)}
              onBlur={onBlur}
              keyboardType="numeric"
              inputMode="decimal"
              hint="How many hours per day you want to spend on activities"
              error={errors.daily_hours_budget?.message ?? null}
            />
          )}
        />

        {detectedTz ? (
          <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
            Detected time zone: {detectedTz}
          </Text>
        ) : null}

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
