/**
 * CommitProgress — full-screen progress for stage 3 of the AI-plan flow.
 *
 * Three phases, announced politely to screen readers:
 *   creating   → "Creating your trip…"
 *   adding     → "Adding 3 of 12…"   (sequential place inserts)
 *   optimizing → "Optimizing your route…"
 *
 * v2 redesign: a staged step rail (Create → Places → Route) shows where the
 * commit is — the rail itself is decorative (hidden from the a11y tree); the
 * polite live-region message remains the screen-reader source of truth.
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

const STAGES: Array<{ key: CommitProgressPhase; label: string }> = [
  { key: 'creating', label: 'Create' },
  { key: 'adding', label: 'Places' },
  { key: 'optimizing', label: 'Route' },
];

export function CommitProgress({ phase, added, total }: CommitProgressProps) {
  const t = useTheme();
  const message =
    phase === 'creating'
      ? 'Creating your trip…'
      : phase === 'adding'
        ? `Adding ${Math.min(added + 1, total)} of ${total}…`
        : 'Optimizing your route…';

  const activeIndex = STAGES.findIndex((s) => s.key === phase);

  return (
    <View style={[styles.root, { gap: t.spacing.lg, padding: t.spacing.xl }]}>
      <View style={[styles.spinnerTile, { backgroundColor: t.colors.gradientSubtle }]}>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </View>
      <Heading level={2}>Building your trip</Heading>

      {/* Staged step rail — decorative; the live region below announces state. */}
      <View
        style={[styles.stageRail, { gap: t.spacing.sm }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
        aria-hidden
      >
        {STAGES.map((stage, i) => {
          const isDone = i < activeIndex;
          const isActive = i === activeIndex;
          return (
            <View
              key={stage.key}
              style={[
                styles.stagePill,
                {
                  backgroundColor: isActive
                    ? t.colors.primary
                    : isDone
                      ? t.colors.gradientSubtle
                      : t.colors.bgMuted,
                  borderRadius: t.radius.pill,
                  paddingHorizontal: t.spacing.md,
                },
              ]}
            >
              <Text
                style={[
                  t.typography.small,
                  {
                    color: isActive
                      ? t.colors.primaryText
                      : isDone
                        ? t.colors.primary
                        : t.colors.textMuted,
                    fontWeight: '700',
                  },
                ]}
              >
                {isDone ? `✓ ${stage.label}` : stage.label}
              </Text>
            </View>
          );
        })}
      </View>

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
  spinnerTile: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageRail: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stagePill: {
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
