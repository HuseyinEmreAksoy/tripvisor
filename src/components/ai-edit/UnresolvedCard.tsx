/**
 * UnresolvedCard — the amber "we couldn't find these" card (v2 Phase N4).
 *
 * Extracted from the DraftReview partial-grounding pattern (N3): names the
 * AI proposed (or the user pasted) that Google couldn't ground are surfaced
 * LOUDLY, never silently dropped (plan-v2 + ux-principles "forgiving").
 * Shared by AiEditSheet, GapFillSheet, and ImportPlacesSheet.
 *
 * Renders nothing when `names` is empty, so callers can pass the raw
 * `unresolved` array unconditionally.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

export interface UnresolvedCardProps {
  names: string[];
  /** Heading; defaults to "We couldn't find N place(s)". */
  title?: string;
  /** Trailing hint line; defaults to the add-by-hand suggestion. */
  hint?: string;
}

export function UnresolvedCard({ names, title, hint }: UnresolvedCardProps) {
  const t = useTheme();
  if (names.length === 0) return null;

  const fallbackTitle = `We couldn't find ${names.length} ${names.length === 1 ? 'place' : 'places'}`;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.card,
        {
          backgroundColor: t.colors.warningLight,
          borderRadius: t.radius.md,
          padding: t.spacing.md,
          gap: t.spacing.xs,
        },
      ]}
    >
      <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
        {title ?? fallbackTitle}
      </Text>
      {names.map((name) => (
        <Text key={name} style={[t.typography.caption, { color: t.colors.textMuted }]}>
          • {name}
        </Text>
      ))}
      <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
        {hint ?? 'You can add them by hand from the trip screen.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'stretch' },
});
