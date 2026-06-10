/**
 * CommitSuccess — post-commit state of the AI-plan flow, with first-class undo.
 *
 * UX bar (docs/v2/ux-principles.md): "undo is first-class". The trip IS
 * created at this point; this screen gives the user a clear beat to reverse
 * it ("Undo — delete this trip") before/instead of opening it. When every
 * place landed, the parent auto-opens the trip after a short pause (and says
 * so); when some places failed we stay put and list them honestly — the trip
 * still exists with everything that did land.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { Button, Heading } from '@/components';

export interface CommitSuccessProps {
  /** Title of the created trip, echoed back for confidence. */
  title: string;
  /** Places that actually landed. */
  placesAdded: number;
  /** Names of places that failed to insert (trip still created). */
  failures: string[];
  /** True while the parent's auto-open timer is running (no failures, no undo yet). */
  autoOpening: boolean;
  onOpen: () => void;
  onUndo: () => void;
  undoPending: boolean;
  undoError?: Error | null;
}

export function CommitSuccess({
  title,
  placesAdded,
  failures,
  autoOpening,
  onOpen,
  onUndo,
  undoPending,
  undoError,
}: CommitSuccessProps) {
  const t = useTheme();

  return (
    <View
      style={[styles.root, { gap: t.spacing.lg, padding: t.spacing.xl }]}
      accessibilityLiveRegion="polite"
    >
      <Text
        style={styles.icon}
        accessibilityElementsHidden
        importantForAccessibility="no"
        aria-hidden
      >
        🎉
      </Text>
      <Heading level={1}>Trip created</Heading>
      <Text
        style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center', lineHeight: 24 }]}
      >
        “{title}” is ready with {placesAdded} {placesAdded === 1 ? 'place' : 'places'}.
        {autoOpening ? ' Opening it now…' : ''}
      </Text>

      {failures.length > 0 ? (
        <View
          accessibilityRole="alert"
          style={[
            styles.failureCard,
            {
              backgroundColor: t.colors.warningLight,
              borderRadius: t.radius.md,
              padding: t.spacing.md,
              gap: t.spacing.xs,
            },
          ]}
        >
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
            {failures.length} {failures.length === 1 ? 'place' : 'places'} couldn't be added
          </Text>
          {failures.map((name) => (
            <Text key={name} style={[t.typography.caption, { color: t.colors.textMuted }]}>
              • {name}
            </Text>
          ))}
          <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
            The trip was still created — you can add these by hand from the trip screen.
          </Text>
        </View>
      ) : null}

      <View style={[styles.actions, { gap: t.spacing.sm }]}>
        <Button
          label={autoOpening ? 'Open trip now' : 'Open trip'}
          onPress={onOpen}
          disabled={undoPending}
        />
        <Button
          variant="danger"
          label="Undo — delete this trip"
          onPress={onUndo}
          loading={undoPending}
          accessibilityLabel="Undo — delete this trip and discard the draft"
        />
        {undoError ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[t.typography.small, { color: t.colors.danger, textAlign: 'center' }]}
          >
            Couldn't delete the trip ({undoError.message}). Try Undo again, or open the trip and
            delete it from Settings.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 56, lineHeight: 64 },
  failureCard: { alignSelf: 'stretch' },
  actions: { alignSelf: 'stretch' },
});
