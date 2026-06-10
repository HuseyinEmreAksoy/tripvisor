/**
 * Signup screen — hero redesign (Phase 20, Step 1) + desktop layout (Phase 20, Step 4).
 *
 * Mobile layout (< 1024px): hero stacked above the form card.
 * Desktop layout (≥ 1024px): hero fills the left half, form sits in the right
 * half centred at max-width 440px, mirroring the login.tsx desktop treatment.
 *
 * Attribution: same Unsplash License note as login.tsx.
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

// Different Unsplash photo from login (mountain lake / dawn scene) to differentiate.
const HERO_URI =
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=75&fm=webp&fit=crop';

const Schema = z.object({
  email: z.string().email('Enter a valid email'),
});

type FormValues = z.infer<typeof Schema>;

export default function Signup() {
  const t = useTheme();
  const router = useRouter();
  const signIn = useSignInWithMagicLink();
  const [sent, setSent] = useState(false);
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
    await signIn.mutateAsync(email);
    setSent(true);
  };

  // Shared form content — rendered identically on desktop and mobile.
  const formContent = (
    <>
      <Heading level={2}>Create account</Heading>

      {/* v2 N1 1.6: Google OAuth above the magic-link form */}
      <GoogleSignInButton />

      <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
        Enter your email to get started. We'll send a magic link — no password needed.
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

      {sent ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[t.typography.body, { color: t.colors.success }]}
        >
          Magic link sent. Check your inbox and tap the link to sign in.
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
        label={sent ? 'Resend magic link' : 'Send magic link'}
        onPress={handleSubmit(onSubmit)}
        loading={signIn.isPending}
        disabled={!isValid}
      />

      <Button
        variant="ghost"
        label="Already have an account? Sign in"
        onPress={() => router.back()}
      />
    </>
  );

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
            placeholder={{ color: '#16332E' }}
          />
          <View
            style={[StyleSheet.absoluteFillObject, { backgroundColor: t.colors.heroOverlay }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
            aria-hidden
          />
          <View style={[styles.desktopHeroCopy, { padding: t.spacing.xxl }]}>
            <Text style={[styles.heroTitle, { color: '#FFFFFF' }]}>
              Start your{'\n'}adventure.
            </Text>
            <Text
              style={[t.typography.body, { color: 'rgba(255,255,255,0.85)', marginTop: t.spacing.sm, lineHeight: 24 }]}
            >
              Free forever. No credit card. Just great trips.
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
              { padding: t.spacing.xxl, gap: t.spacing.lg },
            ]}
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
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* ── Hero section ─────────────────────────────────────────────────── */}
      <View style={styles.heroContainer}>
        <Image
          source={{ uri: HERO_URI }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          accessibilityElementsHidden
          importantForAccessibility="no"
          aria-hidden
          transition={400}
          placeholder={{ color: '#16332E' }}
        />
        <View
          style={[StyleSheet.absoluteFillObject, { backgroundColor: t.colors.heroOverlay }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
          aria-hidden
        />

        <View style={[styles.heroCopy, { padding: t.spacing.xl }]}>
          <Text style={[styles.heroTitle, { color: '#FFFFFF' }]}>
            Start your{'\n'}adventure.
          </Text>
          <Text style={[t.typography.body, { color: 'rgba(255,255,255,0.85)', marginTop: t.spacing.sm, lineHeight: 24 }]}>
            Free forever. No credit card. Just great trips.
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
        {formContent}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

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

  heroContainer: {
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
