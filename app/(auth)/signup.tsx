import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { Button, Heading, Screen, TextField } from '@/components';
import { useSignInWithMagicLink } from '@/api';
import { useTheme } from '@/theme';

const Schema = z.object({
  email: z.string().email('Enter a valid email'),
});

type FormValues = z.infer<typeof Schema>;

export default function Signup() {
  const t = useTheme();
  const router = useRouter();
  const signIn = useSignInWithMagicLink();
  const [sent, setSent] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<FormValues>({
    defaultValues: { email: '' },
    mode: 'onChange',
  });

  const onSubmit = async ({ email }: FormValues) => {
    await signIn.mutateAsync(email);
    setSent(true);
  };

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: t.spacing.lg }}>
        <Heading level={1}>Create account</Heading>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          Enter your email to get started. We'll send a magic link — no password needed.
        </Text>

        <Controller
          control={control}
          name="email"
          rules={{
            validate: (v) => Schema.shape.email.safeParse(v).success || 'Enter a valid email',
          }}
          render={({ field: { value, onChange, onBlur } }) => (
            <TextField
              label="Email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.email?.message ?? null}
            />
          )}
        />

        {sent ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[t.typography.body, { color: t.colors.success }]}
          >
            Magic link sent. Check your inbox.
          </Text>
        ) : null}

        {signIn.error ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[t.typography.small, { color: t.colors.danger }]}
          >
            {(signIn.error as Error).message}
          </Text>
        ) : null}

        <Button
          label={sent ? 'Resend link' : 'Send magic link'}
          onPress={handleSubmit(onSubmit)}
          loading={signIn.isPending}
          disabled={!isValid}
        />

        <Button variant="ghost" label="Back to sign in" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
