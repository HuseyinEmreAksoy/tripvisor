/**
 * LegalDocument — shared chrome for the public legal pages (v2 M4 X3.2):
 * app/legal/privacy.tsx and app/legal/terms.tsx.
 *
 * Those routes sit outside the (app) auth guard so the Play listing, the
 * Data-safety form and signed-out visitors can open them. Content is static
 * (no data fetching), so the web static export pre-renders the full text.
 *
 * M5 Y1.4: the text lives in the `legal` namespace (en + tr). English is the
 * binding version: in any other language a notice says the page is a
 * translation and the English text prevails, with a toggle to read the
 * English original in place (without changing the app language).
 */
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { useSafeBack } from '@/hooks/useSafeBack';
import { useTheme } from '@/theme';
import { formatDate, useAppLocale, useT } from '@/i18n';

export const LEGAL_CONTACT_EMAIL = 'h.emreaksoy@gmail.com';
/** ISO date of the current English text; rendered in the reader's language. */
export const LEGAL_UPDATED = '2026-09-29';

export type LegalDocKey = 'privacy' | 'terms';

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

const SIBLING: Record<LegalDocKey, Href> = {
  privacy: '/legal/terms' as Href,
  terms: '/legal/privacy' as Href,
};

// Literal keys (not `${doc}.title`) so they stay type-checked and visible to i18n:check.
const KEYS = {
  privacy: { title: 'privacy.title', intro: 'privacy.intro', related: 'privacy.related', sections: 'privacy.sections' },
  terms: { title: 'terms.title', intro: 'terms.intro', related: 'terms.related', sections: 'terms.sections' },
} as const;

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : undefined;

/** Defensive read of `returnObjects` output: a malformed translation renders less, never crashes. */
export function toLegalSections(value: unknown): LegalSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    if (typeof s.heading !== 'string') return [];
    return [{ heading: s.heading, paragraphs: strings(s.paragraphs), bullets: strings(s.bullets) }];
  });
}

export function LegalDocument({ doc }: { doc: LegalDocKey }) {
  const t = useTheme();
  const router = useRouter();
  const goBack = useSafeBack('/');
  const { language } = useAppLocale();
  const translated = language !== 'en';
  const [showOriginal, setShowOriginal] = useState(false);
  const docLanguage = translated && showOriginal ? 'en' : language;

  // UI chrome follows the app language; the document body can be the English original.
  const { t: tx } = useT('legal');
  const { t: dx } = useT('legal', { lng: docLanguage });

  const sections = toLegalSections(dx(KEYS[doc].sections, { returnObjects: true, email: LEGAL_CONTACT_EMAIL }));

  const link = (label: string, onPress: () => void, a11y?: string) => (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={a11y ?? label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
    >
      <Text style={[t.typography.bodyStrong, { color: t.colors.primaryInk, textDecorationLine: 'underline' }]}>{label}</Text>
    </Pressable>
  );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={[styles.content, { padding: t.spacing.lg, gap: t.spacing.lg }]}>
        <View style={styles.backRow}>
          <BackButton onPress={goBack} />
        </View>
        <View style={{ gap: t.spacing.xs }}>
          <Text style={[t.typography.overline, { color: t.colors.primaryInk }]}>Tripvisor</Text>
          <Text style={[t.typography.title, { color: t.colors.text }]} accessibilityRole="header" aria-level={1}>
            {dx(KEYS[doc].title)}
          </Text>
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            {dx('chrome.lastUpdated', { date: formatDate(LEGAL_UPDATED, 'long', docLanguage) })}
          </Text>
        </View>

        {translated ? (
          <View
            testID="legal-translation-note"
            style={[
              styles.notice,
              {
                gap: t.spacing.sm,
                padding: t.spacing.md,
                borderRadius: t.radius.lg,
                backgroundColor: t.colors.bgMuted,
                borderColor: t.colors.border,
              },
            ]}
          >
            <View style={[styles.noticeRow, { gap: t.spacing.sm }]}>
              <Icon name="globe" size={18} color={t.colors.primaryInk} />
              <Text style={[t.typography.small, styles.flex, { color: t.colors.text }]}>
                {showOriginal ? tx('chrome.originalNote') : tx('chrome.translationNote')}
              </Text>
            </View>
            {link(showOriginal ? tx('chrome.showTranslation') : tx('chrome.showOriginal'), () =>
              setShowOriginal((v) => !v),
            )}
          </View>
        ) : null}

        <Text style={[t.typography.body, { color: t.colors.text }]}>{dx(KEYS[doc].intro)}</Text>

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
            {dx('chrome.contactHeading')}
          </Text>
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>{dx('chrome.contactBody')}</Text>
          {link(
            LEGAL_CONTACT_EMAIL,
            () => void Linking.openURL(`mailto:${LEGAL_CONTACT_EMAIL}`),
            tx('chrome.emailA11y', { email: LEGAL_CONTACT_EMAIL }),
          )}
          {link(dx(KEYS[doc].related), () => router.push(SIBLING[doc]))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  backRow: { flexDirection: 'row' },
  notice: { borderWidth: StyleSheet.hairlineWidth },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start' },
  bullet: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth },
  link: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
});
