/**
 * Signup screen — hero redesign (Phase 20, Step 1) + desktop layout (Phase 20, Step 4).
 *
 * Mobile layout (< 1024px): hero stacked above the form card.
 * Desktop layout (≥ 1024px): hero fills the left half, form sits in the right
 * half centred at max-width 440px, mirroring the login.tsx desktop treatment.
 *
 * v2 M4 X3.2: keyboard-avoiding on both platforms, return-key submit, plain
 * "no password" copy, and the Terms / Privacy links required for the store
 * listing.
 *
 * Imagery: bundled brand photo (assets/images/hero-signup.jpg).
 */
import { useState } from 'react';
import { useSafeBack } from '@/hooks/useSafeBack';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { Button, GoogleSignInButton, Heading, TextField } from '@/components';
import { HeroValueChips } from '@/components/HeroValueChips';
import { LegalLinks } from '@/components/legal/LegalLinks';
import { useSignInWithMagicLink } from '@/api';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';

// Bundled brand art (mountain road at sunrise) — distinct from login, offline-safe.
const HERO_SOURCE = require('../../assets/images/hero-signup.jpg');

const Schema = z.object({
  email: z.string().email('Enter a valid email'),
});

type FormValues = z.infer<typeof Schema>;

export default function Signup() {
  const t = useTheme();
  const goBack = useSafeBack('/login');
  const signIn = useSignInWithMagicLink();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const bp = useBreakpoint();
  const isDesktop = bp === 'desktop';

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
      await signIn.mutateAsync(email.trim());
      setSentTo(email.trim());
    } catch {
      // Error surfaces via signIn.error
    }
  };

  // Shared form content — rendered identically on desktop and mobile.
  const formContent = (
    <>
      <Heading level={2}>Create your free account</Heading>

      {/* v2 N1 1.6: Google OAuth above the magic-link form */}
      <GoogleSignInButton />

      <View style={[styles.orRow, { gap: t.spacing.sm }]} accessibilityElementsHidden importantForAccessibility="no">
        <View style={[styles.orLine, { backgroundColor: t.colors.border }]} />
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>or with email</Text>
        <View style={[styles.orLine, { backgroundColor: t.colors.border }]} />
      </View>

      <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
        No password to create or remember. Enter your email and we’ll send a one-time link that sets up your account
        and signs you in.
      </Text>

      <Controller
        control={control}
        name="email"
        rules={{
          validate: (v) => Schema.shape.email.safeParse(v.trim()).success || 'Enter a valid email',
        }}
        render={({ field: { value, onChange, onBlur } }) => (
          <TextField
            label="Email address"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            inputMode="email"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={handleSubmit(onSubmit)}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.email?.message ?? null}
          />
        )}
      />

      {sentTo ? (
        <Text accessibilityLiveRegion="polite" style={[t.typography.body, { color: t.colors.success }]}>
          {`Link sent to ${sentTo}. Open it on this device to finish. Can’t find it? Check your spam folder.`}
        </Text>
      ) : null}

      {signIn.error ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[t.typography.small, { color: t.colors.danger }]}>
          {(signIn.error as Error).message}
        </Text>
      ) : null}

      <Button
        label={sentTo ? 'Resend link' : 'Email me a sign-up link'}
        onPress={handleSubmit(onSubmit)}
        loading={signIn.isPending}
        disabled={!isValid}
      />

      <Button variant="ghost" label="Already have an account? Sign in" onPress={goBack} />

      <LegalLinks prefix="By creating an account you agree to the" />
    </>
  );

  const heroBackdrop = (
    <>
      <Image
        source={HERO_SOURCE}
        style={[StyleSheet.absoluteFillObject, { backgroundColor: '#16332E' }]}
        contentFit="cover"
        accessibilityElementsHidden
        importantForAccessibility="no"
        aria-hidden
        transition={400}
      />
      <View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: t.colors.heroOverlay }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
        aria-hidden
      />
    </>
  );

  const heroCopy = (
    <>
      <Text style={[styles.heroTitle, { color: '#FFFFFF' }]}>Start your{'\n'}adventure.</Text>
      <Text style={[t.typography.body, { color: 'rgba(255,255,255,0.85)', marginTop: t.spacing.sm, lineHeight: 24 }]}>
        Free forever. No credit card. Just great trips.
      </Text>
      <HeroValueChips />
    </>
  );

  // ── Desktop two-column layout ─────────────────────────────────────────────
  if (isDesktop) {
    return (
      <View style={[styles.root, styles.desktopRoot, { backgroundColor: t.colors.bg }]}>
        <View style={styles.desktopHero}>
          {heroBackdrop}
          <View style={[styles.desktopHeroCopy, { padding: t.spacing.xxl }]}>{heroCopy}</View>
        </View>

        <View style={[styles.desktopFormOuter, { backgroundColor: t.colors.bg }]}>
          <ScrollView
            contentContainerStyle={[styles.desktopFormInner, { padding: t.spacing.xxl, gap: t.spacing.lg }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {formContent}
          </ScrollView>
        </View>
      </View>
    );
  }

  // ── Mobile / tablet stacked layout ───────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: t.colors.bg }]}
      behavior={Platform.OS === 'web' ? undefined : 'padding'}
    >
      <ScrollView
        contentContainerStyle={styles.mobileScroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroContainer}>
          {heroBackdrop}
          <View style={[styles.heroCopy, { padding: t.spacing.xl, paddingBottom: t.spacing.xl + 28 }]}>{heroCopy}</View>
        </View>

        <View style={[styles.formCard, { backgroundColor: t.colors.bg, padding: t.spacing.xl, gap: t.spacing.lg }]}>
          {formContent}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  desktopRoot: { flexDirection: 'row' },
  desktopHero: { flex: 1, overflow: 'hidden' },
  desktopHeroCopy: { flex: 1, justifyContent: 'flex-end' },
  desktopFormOuter: { width: 520, justifyContent: 'center' },
  desktopFormInner: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    flexGrow: 1,
    justifyContent: 'center',
  },

  // One scroll view holds hero + form so the keyboard never hides the button.
  mobileScroll: { flexGrow: 1 },
  heroContainer: {
    minHeight: 240,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  heroCopy: { justifyContent: 'flex-end' },
  heroTitle: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  formCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -28,
    flexGrow: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  orRow: { flexDirection: 'row', alignItems: 'center' },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth },
});
