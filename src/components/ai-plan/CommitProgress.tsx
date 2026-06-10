/**
 * CommitProgress — full-screen progress for stage 3 of the AI-plan flow.
 *
 * Three phases, announced politely to screen readers:
 *   creating   → "Creating your trip…"
 *   adding     → "Adding 3 of 12…"   (sequential place inserts)
 *   optimizing → "Optimizing your route…"
 *
 * No back affordance here on purpose: the commit finishes in seconds and
 * always lands on an actionable state (success-with-undo, or back on the
 * review screen with the error) — interrupting mid-write is the one way a
 * user COULD get stranded with a half-built trip.
 */
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { Heading } from '@/components';

export type CommitProgressPhase = 'creating' | 'adding' | 'optimizing';

export interface CommitProgressProps {
  phase: CommitProgressPhase;
  /** Places already processed (adding phase). */
  added: number;
  /** Total kept places being added. */
  total: number;
}

export function CommitProgress({ phase, added, total }: CommitProgressProps) {
  const t = useTheme();
  const message =
    phase === 'creating'
      ? 'Creating your trip…'
      : phase === 'adding'
        ? `Adding ${Math.min(added + 1, total)} of ${total}…`
        : 'Optimizing your route…';

  return (
    <View style={[styles.root, { gap: t.spacing.lg, padding: t.spacing.xl }]}>
      <ActivityIndicator size="large" color={t.colors.primary} />
      <Heading level={2}>Building your trip</Heading>
      <Text
        accessibilityLiveRegion="polite"
        style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center' }]}
      >
        {message}
      </Text>
      <Text style={[t.typography.small, { color: t.colors.textMuted, textAlign: 'center' }]}>
        This takes a few seconds — you'll get a chance to undo right after.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
