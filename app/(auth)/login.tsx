/**
 * Login screen — hero redesign (Phase 20, Step 1) + desktop layout (Phase 20, Step 4).
 *
 * Mobile layout (< 1024px): hero image with overlay copy above a form card
 * lifted over it. Desktop layout (≥ 1024px): hero fills the left half, form
 * sits in the right half centred at max-width 440px.
 *
 * v2 M4 X3.2 phone polish: keyboard-avoiding on both platforms (SDK 54 is
 * edge-to-edge on Android, so the window no longer resizes for the keyboard),
 * return-key submit, and plain copy on how sign-in works — Tripvisor has no
 * password sign-in; a one-time email link (or Google) signs you in, and the
 * same link creates the account for a new email.
 *
 * Imagery: bundled brand photo (assets/images/hero-login.jpg), works offline.
 * Decorative — accessibilityElementsHidden keeps it out of the screen-reader tree.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { Button, GoogleSignInButton, Heading, Icon, TextField } from '@/components';
import { HeroValueChips } from '@/components/HeroValueChips';
import { LegalLinks } from '@/components/legal/LegalLinks';
import { useSignInWithMagicLink } from '@/api';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';

// Bundled brand art (generated 2026-09-28) — offline-safe and COEP-safe, unlike a hotlink.
const HERO_SOURCE = require('../../assets/images/hero-login.jpg');

const Schema = z.object({
  email: z.string().email('Enter a valid email'),
});

type FormValues = z.infer<typeof Schema>;

export default function Login() {
  const t = useTheme();
  const router = useRouter();
  const signIn = useSignInWithMagicLink();
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
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
      setSubmittedEmail(email.trim());
      setResent(false);
    } catch {
      // Error surfaces via signIn.error
    }
  };

  const resend = async () => {
    if (!submittedEmail) return;
    try {
      await signIn.mutateAsync(submittedEmail);
      setResent(true);
    } catch {
      // Error surfaces via signIn.error
    }
  };

  const errorText = signIn.error ? (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[t.typography.small, { color: t.colors.danger }]}>
      {(signIn.error as Error).message}
    </Text>
  ) : null;

  // ── "Check your inbox" confirmation view ──────────────────────────────────
  if (submittedEmail) {
    return (
      <View style={[styles.root, { backgroundColor: t.colors.bg }]}>
        <ScrollView contentContainerStyle={[styles.confirmCard, { padding: t.spacing.xxl, gap: t.spacing.lg }]}>
          <View style={[styles.confirmIcon, { backgroundColor: t.colors.gradientSubtle, borderRadius: t.radius.pill }]}>
            <Icon name="mail" size={36} color={t.colors.primary} />
          </View>
          <Heading level={1}>Check your inbox</Heading>
          <Text style={[t.typography.body, styles.center, { color: t.colors.textMuted }]}>
            We sent a sign-in link to{' '}
            <Text style={[t.typography.bodyStrong, { color: t.colors.primary }]}>{submittedEmail}</Text>. Open it on
            this device and you’re in. No password needed.
          </Text>
          <Text style={[t.typography.caption, styles.center, { color: t.colors.textMuted }]}>
            The link works once and expires after about an hour. Can’t find it? Check your spam folder.
          </Text>
          {resent ? (
            <Text accessibilityLiveRegion="polite" style={[t.typography.caption, { color: t.colors.success }]}>
              A new link is on its way.
            </Text>
          ) : null}
          {errorText}
          <View style={[styles.confirmActions, { gap: t.spacing.sm }]}>
            <Button label="Resend link" variant="secondary" onPress={resend} loading={signIn.isPending} />
            <Button
              variant="ghost"
              label="Use a different email"
              onPress={() => {
                signIn.reset();
                setSubmittedEmail(null);
              }}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  const formContent = (
    <>
      <Heading level={2}>Sign in</Heading>

      {/* v2 N1 1.6: Google OAuth above the magic-link form */}
      <GoogleSignInButton />

      <View style={[styles.orRow, { gap: t.spacing.sm }]} accessibilityElementsHidden importantForAccessibility="no">
        <View style={[styles.orLine, { backgroundColor: t.colors.border }]} />
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>or with email</Text>
        <View style={[styles.orLine, { backgroundColor: t.colors.border }]} />
      </View>

      <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
        No password needed. Enter your email and we’ll send you a one-time sign-in link.
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

      {errorText}

      <Button
        label="Email me a sign-in link"
        onPress={handleSubmit(onSubmit)}
        loading={signIn.isPending}
        disabled={!isValid}
      />

      <Button variant="ghost" label="New to Tripvisor? Create an account" onPress={() => router.push('/signup')} />

      <LegalLinks prefix="By signing in you agree to the" />
    </>
  );

  // ── Desktop two-column layout ─────────────────────────────────────────────
  if (isDesktop) {
    return (
      <View style={[styles.root, styles.desktopRoot, { backgroundColor: t.colors.bg }]}>
        <View style={styles.desktopHero}>
          <HeroBackdrop />
          <View style={[styles.desktopHeroCopy, { padding: t.spacing.xxl }]}>
            <HeroCopy />
          </View>
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
          <HeroBackdrop />
          <View style={[styles.heroCopy, { padding: t.spacing.xl, paddingBottom: t.spacing.xl + 28 }]}>
            <HeroCopy />
          </View>
        </View>

        <View style={[styles.formCard, { backgroundColor: t.colors.bg, padding: t.spacing.xl, gap: t.spacing.lg }]}>
          {formContent}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function HeroBackdrop() {
  const t = useTheme();
  return (
    <>
      <Image
        source={HERO_SOURCE}
        style={[StyleSheet.absoluteFillObject, { backgroundColor: '#16332E' }]}
        contentFit="cover"
        accessibilityElementsHidden
        importantForAccessibility="no"
        aria-hidden
        // Fade in over the backgroundColor placeholder.
        transition={400}
      />
      {/* Dark scrim over the photo for text legibility */}
      <View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: t.colors.heroOverlay }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
        aria-hidden
      />
    </>
  );
}

function HeroCopy() {
  const t = useTheme();
  return (
    <>
      <Text style={[styles.heroTitle, { color: '#FFFFFF' }]}>Your trip,{'\n'}perfectly planned.</Text>
      <Text style={[t.typography.body, { color: 'rgba(255,255,255,0.85)', marginTop: t.spacing.sm, lineHeight: 24 }]}>
        Add destinations, optimise your days, share with your crew.
      </Text>
      <HeroValueChips />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { textAlign: 'center' },

  // ── Desktop two-column ────────────────────────────────────────────────────
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

  // ── Mobile / tablet stacked ───────────────────────────────────────────────
  // One scroll view holds hero + form, so with the keyboard up the email
  // field and the submit button can always be scrolled into view.
  mobileScroll: { flexGrow: 1 },
  heroContainer: {
    minHeight: 260,
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
  confirmCard: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  confirmActions: { alignSelf: 'stretch' },
  confirmIcon: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
});
