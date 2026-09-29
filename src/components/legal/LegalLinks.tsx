/**
 * LegalLinks — "By signing in you agree to the Terms of use and Privacy
 * policy" line for the auth screens (v2 M4 X3.2). Links open the public
 * /legal/* pages, which work signed-out.
 *
 * The sentence is one translation with `<terms>` / `<privacy>` tags (Trans),
 * because Turkish puts the verb last and attaches case suffixes to the link
 * text ("Kullanım koşullarını … kabul etmiş olursun").
 */
import { Text } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTheme } from '@/theme';
import { Trans, useT } from '@/i18n';

export const PRIVACY_HREF = '/legal/privacy' as Href;
export const TERMS_HREF = '/legal/terms' as Href;

export function LegalLinks({ variant }: { variant: 'signIn' | 'signUp' }) {
  const t = useTheme();
  const router = useRouter();
  const { t: tx } = useT('auth');
  const linkStyle = [t.typography.caption, { color: t.colors.primary, textDecorationLine: 'underline' as const }];
  return (
    <Text style={[t.typography.caption, { color: t.colors.textMuted, textAlign: 'center' }]}>
      <Trans
        t={tx}
        i18nKey={variant === 'signIn' ? 'legalLinks.signIn' : 'legalLinks.signUp'}
        components={{
          terms: <Text accessibilityRole="link" onPress={() => router.push(TERMS_HREF)} style={linkStyle} />,
          privacy: <Text accessibilityRole="link" onPress={() => router.push(PRIVACY_HREF)} style={linkStyle} />,
        }}
      />
    </Text>
  );
}
