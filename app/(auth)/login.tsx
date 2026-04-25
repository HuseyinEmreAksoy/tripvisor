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
 * Imagery: Unsplash CDN source URL. Requires network; graceful fallback is a
 * gradient bg (`t.colors.primary`-tinted) while loading or on error.
 *
 * Attribution: Unsplash Source API images are provided under the Unsplash
 * License (free to use, no attribution required per Unsplash ToS when using
 * the Source API). The decorative accessibilityElementsHidden flag keeps the
 * background out of the screen-reader tree.
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
import { Button, Heading, TextField } from '@/components';
import { useSignInWithMagicLink } from '@/api';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';

// Unsplash Source API — returns a random travel/destination photo at 1200×800.
// The `?sig=1` param ensures stable caching per session (same photo won't
// change mid-session) while still rotating on next cold load.
const HERO_URI =
  'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1200&q=75&fm=webp&fit=crop';

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
          <Text style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center' }]}>
            We sent a magic link to{' '}
            <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
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
            source={{ uri: HERO_URI }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            accessibilityElementsHidden
            importantForAccessibility="no"
            aria-hidden
            transition={400}
            placeholder={{ color: '#1A3A5C' }}
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
              style={[t.typography.body, { color: 'rgba(255,255,255,0.85)', marginTop: t.spacing.sm }]}
            >
              Add destinations, optimise your days, share with your crew.
            </Text>
          </View>
        </View>

        {/* Right column — form, vertically centred, max-width 440px */}
        <View style={[styles.desktopFormOuter, { backgroundColor: t.colors.bg }]}>
          <ScrollView
            contentContainerStyle={[
              styles.desktopFormInner,
              {
                padding: t.spacing.xxl,
                gap: t.spacing.md,
              },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Heading level={2}>Sign in</Heading>
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
          source={{ uri: HERO_URI }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          // Decorative background — excluded from a11y tree.
          accessibilityElementsHidden
          importantForAccessibility="no"
          aria-hidden
          // Fade in from placeholder.
          transition={400}
          placeholder={{ color: '#1A3A5C' }}
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
          <Text style={[t.typography.body, { color: 'rgba(255,255,255,0.85)', marginTop: t.spacing.sm }]}>
            Add destinations, optimise your days, share with your crew.
          </Text>
        </View>
      </View>

      {/* ── Form card ────────────────────────────────────────────────────── */}
      <ScrollView
        contentContainerStyle={[
          styles.formCard,
          {
            backgroundColor: t.colors.bg,
            padding: t.spacing.xl,
            gap: t.spacing.md,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Heading level={2}>Sign in</Heading>
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
    // Left column: fills half the viewport.
    flex: 1,
    overflow: 'hidden',
  },
  desktopHeroCopy: {
    // Push copy to the bottom third of the hero column.
    flex: 1,
    justifyContent: 'flex-end',
  },
  desktopFormOuter: {
    // Right column: fixed-width panel, vertically centred form inside.
    width: 480,
    justifyContent: 'center',
  },
  desktopFormInner: {
    // Form content is constrained to 440px and centred within the 480px panel.
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    flexGrow: 1,
    justifyContent: 'center',
  },

  // ── Mobile / tablet stacked ───────────────────────────────────────────────
  heroContainer: {
    flex: 1,
    // Hero takes ~55% of viewport; the form card takes the rest.
    // On very small screens (iPhone SE = 568pt) min is capped so the form fits.
    minHeight: 220,
    maxHeight: 340,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  heroCopy: {
    // Sits at the bottom of the hero over the scrim.
    justifyContent: 'flex-end',
  },
  heroTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  formCard: {
    // Slight top-radius makes the card feel lifted above the hero.
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: -20,
    flexGrow: 1,
  },
  confirmCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  confirmIcon: {
    fontSize: 48,
  },
});
