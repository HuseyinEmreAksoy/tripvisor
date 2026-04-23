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

export default function Login() {
  const t = useTheme();
  const router = useRouter();
  const signIn = useSignInWithMagicLink();
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<FormValues>({
    defaultValues: { email: '' },
    mode: 'onChange',
  });

  const onSubmit = async ({ email }: FormValues) => {
    try {
      await signIn.mutateAsync(email);
      setSubmittedEmail(email);
    } catch (err) {
      // Error surfaces via signIn.error
    }
  };

  if (submittedEmail) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', gap: t.spacing.lg }}>
          <Heading level={1}>Check your inbox</Heading>
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
            We sent a magic link to {submittedEmail}. Tap it to sign in.
          </Text>
          <Button
            variant="secondary"
            label="Use a different email"
            onPress={() => setSubmittedEmail(null)}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: t.spacing.lg }}>
        <Heading level={1}>Sign in</Heading>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          Enter your email. We'll send you a magic link.
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

        {signIn.error ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[t.typography.small, { color: t.colors.danger }]}
          >
            {(signIn.error as Error).message}
          </Text>
        ) : null}

        <Button
          label="Send magic link"
          onPress={handleSubmit(onSubmit)}
          loading={signIn.isPending}
          disabled={!isValid}
        />

        <Button
          variant="ghost"
          label="Create account"
          onPress={() => router.push('/signup')}
        />
      </View>
    </Screen>
  );
}
