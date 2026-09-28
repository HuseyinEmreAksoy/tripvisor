/**
 * Login screen — hero redesign (Phase 20, Step 1) + desktop layout (Phase 20, Step 4).
 *
 * Mobile layout (< 1024px):
 *   - Top ~55% of the screen: full-bleed hero image with a dark overlay and
 *     large headline text.
 *   - Bottom: scrollable card lifted over the image with the auth form.
 *
 * Desktop layout (≥ 1024px):
 *   - Left half: full-viewport hero image with overlay and copy.
 *   - Right half: vertically-centred form card, max-width 440px.
 *   This is a Row split so neither side scrolls independently — only the right
 *   panel scrolls when the viewport is short enough to require it.
 *
 * Imagery: bundled brand photo (assets/images/hero-login.jpg), works offline.
 * Decorative — accessibilityElementsHidden keeps it out of the screen-reader tree.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { Button, GoogleSignInButton, Heading, TextField } from '@/components';
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
      await signIn.mutateAsync(email);
      setSubmittedEmail(email);
    } catch {
      // Error surfaces via signIn.error
    }
  };

  // ── "Check your inbox" confirmation view ──────────────────────────────────
  if (submittedEmail) {
    return (
      <View style={[styles.root, { backgroundColor: t.colors.bg }]}>
        <View style={[styles.confirmCard, { backgroundColor: t.colors.bg, padding: t.spacing.xxl }]}>
          {/* Map-pin glyph as accent — purely decorative */}
          <Text
            style={styles.confirmIcon}
            accessibilityElementsHidden
            importantForAccessibility="no"
            aria-hidden
          >
            ✈️
          </Text>
          <Heading level={1}>Check your inbox</Heading>
          <Text style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center', lineHeight: 24 }]}>
            We sent a magic link to{' '}
            <Text style={[t.typography.bodyStrong, { color: t.colors.primary }]}>
              {submittedEmail}
            </Text>
            . Tap it to sign in — no password needed.
          </Text>
          <Button
            variant="secondary"
            label="Use a different email"
            onPress={() => setSubmittedEmail(null)}
          />
        </View>
      </View>
    );
  }

  // ── Desktop two-column layout ─────────────────────────────────────────────
  if (isDesktop) {
    return (
      <View style={[styles.root, styles.desktopRoot, { backgroundColor: t.colors.bg }]}>
        {/* Left column — hero image fills the full height */}
        <View style={styles.desktopHero}>
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
          <View style={[styles.desktopHeroCopy, { padding: t.spacing.xxl }]}>
            <Text style={[styles.heroTitle, { color: '#FFFFFF' }]}>
              Your trip,{'\n'}perfectly planned.
            </Text>
            <Text
              style={[t.typography.body, { color: 'rgba(255,255,255,0.85)', marginTop: t.spacing.sm, lineHeight: 24 }]}
            >
              Add destinations, optimise your days, share with your crew.
            </Text>
            {/* Value prop chips */}
            <View style={styles.chipRow}>
              {['✈️ Plan', '🗺️ Optimize', '👥 Share'].map((chip) => (
                <View key={chip} style={[styles.valueChip, { backgroundColor: t.colors.heroChipBg, borderRadius: t.radius.pill }]}>
                  <Text style={[t.typography.caption, { color: t.colors.heroChipText }]}>{chip}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Right column — form, vertically centred, max-width 440px */}
        <View style={[styles.desktopFormOuter, { backgroundColor: t.colors.bg }]}>
          <ScrollView
            contentContainerStyle={[
              styles.desktopFormInner,
              {
                padding: t.spacing.xxl,
                gap: t.spacing.lg,
              },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Heading level={2}>Sign in</Heading>

            {/* v2 N1 1.6: Google OAuth above the magic-link form */}
            <GoogleSignInButton />

            <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
              Enter your email — we'll send a magic link. No password required.
            </Text>

            <Controller
              control={control}
              name="email"
              rules={{
                validate: (v) =>
                  Schema.shape.email.safeParse(v).success || 'Enter a valid email',
              }}
              render={({ field: { value, onChange, onBlur } }) => (
                <TextField
                  label="Email address"
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
              label="Don't have an account? Sign up"
              onPress={() => router.push('/signup')}
            />
          </ScrollView>
        </View>
      </View>
    );
  }

  // ── Mobile / tablet stacked layout ───────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: t.colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* ── Hero section ─────────────────────────────────────────────────── */}
      <View style={styles.heroContainer}>
        <Image
          source={HERO_SOURCE}
          style={[StyleSheet.absoluteFillObject, { backgroundColor: '#16332E' }]}
          contentFit="cover"
          // Decorative background — excluded from a11y tree.
          accessibilityElementsHidden
          importantForAccessibility="no"
          aria-hidden
          // Fade in over the backgroundColor placeholder (expo-image 2.4 dropped
          // `{ color }` placeholder sources; style background serves the same role).
          transition={400}
        />
        {/* Dark scrim over the photo for text legibility */}
        <View
          style={[StyleSheet.absoluteFillObject, { backgroundColor: t.colors.heroOverlay }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
          aria-hidden
        />

        {/* Hero copy */}
        <View style={[styles.heroCopy, { padding: t.spacing.xl }]}>
          <Text style={[styles.heroTitle, { color: '#FFFFFF' }]}>
            Your trip,{'\n'}perfectly planned.
          </Text>
          <Text style={[t.typography.body, { color: 'rgba(255,255,255,0.85)', marginTop: t.spacing.sm, lineHeight: 24 }]}>
            Add destinations, optimise your days, share with your crew.
          </Text>
          {/* Value prop chips */}
          <View style={styles.chipRow}>
            {['✈️ Plan', '🗺️ Optimize', '👥 Share'].map((chip) => (
              <View key={chip} style={[styles.valueChip, { backgroundColor: t.colors.heroChipBg, borderRadius: t.radius.pill }]}>
                <Text style={[t.typography.caption, { color: t.colors.heroChipText }]}>{chip}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* ── Form card ────────────────────────────────────────────────────── */}
      <ScrollView
        contentContainerStyle={[
          styles.formCard,
          {
            backgroundColor: t.colors.bg,
            padding: t.spacing.xl,
            gap: t.spacing.lg,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Heading level={2}>Sign in</Heading>

        {/* v2 N1 1.6: Google OAuth above the magic-link form */}
        <GoogleSignInButton />

        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          Enter your email — we'll send a magic link. No password required.
        </Text>

        <Controller
          control={control}
          name="email"
          rules={{
            validate: (v) =>
              Schema.shape.email.safeParse(v).success || 'Enter a valid email',
          }}
          render={({ field: { value, onChange, onBlur } }) => (
            <TextField
              label="Email address"
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
          label="Don't have an account? Sign up"
          onPress={() => router.push('/signup')}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // ── Desktop two-column ────────────────────────────────────────────────────
  desktopRoot: {
    flexDirection: 'row',
  },
  desktopHero: {
    flex: 1,
    overflow: 'hidden',
  },
  desktopHeroCopy: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  desktopFormOuter: {
    width: 520,
    justifyContent: 'center',
  },
  desktopFormInner: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    flexGrow: 1,
    justifyContent: 'center',
  },

  // ── Mobile / tablet stacked ───────────────────────────────────────────────
  heroContainer: {
    flex: 1,
    minHeight: 240,
    maxHeight: 360,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  heroCopy: {
    justifyContent: 'flex-end',
  },
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
  },
  confirmCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  confirmIcon: {
    fontSize: 56,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    flexWrap: 'wrap',
  },
  valueChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
});
