/**
 * LegalDocument — shared chrome for the public legal pages (v2 M4 X3.2):
 * app/legal/privacy.tsx and app/legal/terms.tsx.
 *
 * Those routes sit outside the (app) auth guard so the Play listing, the
 * Data-safety form and signed-out visitors can open them. Content is static
 * (no data fetching), so the web static export pre-renders the full text.
 */
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { useSafeBack } from '@/hooks/useSafeBack';
import { useTheme } from '@/theme';

export const LEGAL_CONTACT_EMAIL = 'h.emreaksoy@gmail.com';
export const LEGAL_UPDATED = '29 September 2026';

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDocumentProps {
  title: string;
  intro: string;
  sections: LegalSection[];
  /** The sibling document, linked at the bottom. */
  related: { label: string; href: Href };
}

export function LegalDocument({ title, intro, sections, related }: LegalDocumentProps) {
  const t = useTheme();
  const router = useRouter();
  const goBack = useSafeBack('/');

  const link = (label: string, onPress: () => void, a11y?: string) => (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={a11y ?? label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
    >
      <Text style={[t.typography.bodyStrong, { color: t.colors.primary, textDecorationLine: 'underline' }]}>{label}</Text>
    </Pressable>
  );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={[styles.content, { padding: t.spacing.lg, gap: t.spacing.lg }]}>
        <View style={styles.backRow}>
          <BackButton onPress={goBack} />
        </View>
        <View style={{ gap: t.spacing.xs }}>
          <Text style={[t.typography.overline, { color: t.colors.primary }]}>Tripvisor</Text>
          <Text style={[t.typography.title, { color: t.colors.text }]} accessibilityRole="header" aria-level={1}>
            {title}
          </Text>
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{`Last updated ${LEGAL_UPDATED}`}</Text>
        </View>
        <Text style={[t.typography.body, { color: t.colors.text }]}>{intro}</Text>

        {sections.map((s) => (
          <View key={s.heading} style={{ gap: t.spacing.sm }}>
            <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header" aria-level={2}>
              {s.heading}
            </Text>
            {s.paragraphs?.map((p) => (
              <Text key={p} style={[t.typography.body, { color: t.colors.textMuted }]}>
                {p}
              </Text>
            ))}
            {s.bullets?.map((b) => (
              <View key={b} style={[styles.bullet, { gap: t.spacing.sm }]}>
                <Text style={[t.typography.body, { color: t.colors.primary }]} aria-hidden accessibilityElementsHidden importantForAccessibility="no">
                  •
                </Text>
                <Text style={[t.typography.body, styles.flex, { color: t.colors.textMuted }]}>{b}</Text>
              </View>
            ))}
          </View>
        ))}

        <View style={[styles.footer, { gap: t.spacing.sm, borderTopColor: t.colors.border, paddingTop: t.spacing.lg }]}>
          <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header" aria-level={2}>
            Contact
          </Text>
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
            Questions, data requests or complaints: email the developer and you’ll get a reply within 30 days.
          </Text>
          {link(LEGAL_CONTACT_EMAIL, () => void Linking.openURL(`mailto:${LEGAL_CONTACT_EMAIL}`), `Email ${LEGAL_CONTACT_EMAIL}`)}
          {link(related.label, () => router.push(related.href))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  backRow: { flexDirection: 'row' },
  bullet: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth },
  link: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
});
