/**
 * LegalLinks — "By continuing you agree to the Terms of use and Privacy
 * policy" line for the auth screens (v2 M4 X3.2). Links open the public
 * /legal/* pages, which work signed-out.
 */
import { Text } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTheme } from '@/theme';

export const PRIVACY_HREF = '/legal/privacy' as Href;
export const TERMS_HREF = '/legal/terms' as Href;

export function LegalLinks({ prefix = 'By continuing you agree to the' }: { prefix?: string }) {
  const t = useTheme();
  const router = useRouter();
  const linkStyle = [t.typography.caption, { color: t.colors.primary, textDecorationLine: 'underline' as const }];
  return (
    <Text style={[t.typography.caption, { color: t.colors.textMuted, textAlign: 'center' }]}>
      {`${prefix} `}
      <Text accessibilityRole="link" onPress={() => router.push(TERMS_HREF)} style={linkStyle}>
        Terms of use
      </Text>
      {' and '}
      <Text accessibilityRole="link" onPress={() => router.push(PRIVACY_HREF)} style={linkStyle}>
        Privacy policy
      </Text>
      .
    </Text>
  );
}
