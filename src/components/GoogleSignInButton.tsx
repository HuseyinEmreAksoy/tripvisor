/**
 * GoogleSignInButton — "Continue with Google" + the "or" divider
 * (v2 Phase N1 step 1.6). Mounted ABOVE the magic-link email form on the
 * login and signup screens. It owns the ONLY "or continue with email"
 * divider, so screens must not render a second one.
 *
 * Self-contained: owns the useGoogleSignIn mutation and its error surface.
 * When the provider isn't configured in Supabase yet (config lands in N2),
 * the error collapses to a friendly inline note instead of a raw API error —
 * email sign-in below remains the working path.
 *
 * Usage:
 *   <GoogleSignInButton />   // then render the email form below it
 */
import { StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { useTheme } from '@/theme';
import { useGoogleSignIn } from '@/hooks/useGoogleSignIn';
import { useT } from '@/i18n';

export function GoogleSignInButton() {
  const t = useTheme();
  const { t: tx } = useT('auth');
  const google = useGoogleSignIn();

  return (
    <View style={{ gap: t.spacing.md }}>
      <Button
        variant="secondary"
        label={tx('google.continue')}
        loading={google.isPending}
        onPress={() => google.mutate()}
        leftIcon={
          <Text
            style={styles.gGlyph}
            accessibilityElementsHidden
            importantForAccessibility="no"
            aria-hidden
          >
            G
          </Text>
        }
      />

      {google.isError ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[t.typography.small, { color: t.colors.danger, textAlign: 'center' }]}
        >
          {tx('google.notConfigured')}
        </Text>
      ) : null}

      {/* "or" divider between OAuth and the email form */}
      <View style={styles.dividerRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.dividerLine, { backgroundColor: t.colors.border }]} />
        <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('google.orEmail')}</Text>
        <View style={[styles.dividerLine, { backgroundColor: t.colors.border }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Simple high-contrast "G" glyph — no brand asset dependency for the MVP.
  gGlyph: {
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '800',
    color: '#4285F4',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
});
