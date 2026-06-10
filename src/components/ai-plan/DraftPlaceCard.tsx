/**
 * DraftPlaceCard — one place row inside the AI draft review (stage 2).
 *
 * Kept state: name + category chip, an editable visit-duration stepper
 * (the shared VisitDurationStepper, capped at the server's 480-minute
 * validation ceiling), a compact "Day N" reassign stepper, and a Remove
 * action.
 *
 * Removed state (forgiving, per docs/v2/ux-principles.md): the card stays in
 * place, dimmed with a strikethrough title, and the WHOLE card is a single
 * "restore" button — nothing is ever silently dropped or hard to get back.
 *
 * Memoized: the review list re-renders on every stepper tap; with the
 * parent's useCallback'd handlers only the touched card re-renders.
 */
import { memo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { VisitDurationStepper } from '@/components';
import { Stepper } from './Stepper';
import type { DraftPlaceEdit } from './types';

export interface DraftPlaceCardProps {
  place: DraftPlaceEdit;
  /** Total days in the draft — bounds the "Day N" reassign stepper. */
  dayCount: number;
  onToggleKept: (localId: string) => void;
  onChangeMinutes: (localId: string, minutes: number) => void;
  onChangeDay: (localId: string, day: number) => void;
}

/** "art_gallery" → "Art gallery" for the category chip. */
function formatCategory(category: string): string {
  const cleaned = category.replace(/_/g, ' ').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export const DraftPlaceCard = memo(function DraftPlaceCard({
  place,
  dayCount,
  onToggleKept,
  onChangeMinutes,
  onChangeDay,
}: DraftPlaceCardProps) {
  const t = useTheme();

  // ── Removed: dimmed, strikethrough, whole card restores ──────────────────
  if (!place.kept) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Restore ${place.name} to the draft`}
        onPress={() => onToggleKept(place.localId)}
        style={({ pressed }) => [
          styles.card,
          styles.removedCard,
          {
            backgroundColor: t.colors.bgMuted,
            borderColor: t.colors.border,
            borderRadius: t.radius.lg,
            padding: t.spacing.md,
            opacity: pressed ? 0.55 : 0.7,
          },
          Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
        ]}
      >
        <Text
          style={[
            t.typography.bodyStrong,
            { color: t.colors.textMuted, textDecorationLine: 'line-through', flex: 1 },
          ]}
          numberOfLines={1}
        >
          {place.name}
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.primary, fontWeight: '600' }]}>
          Removed — tap to restore
        </Text>
      </Pressable>
    );
  }

  // ── Kept: full editing surface ────────────────────────────────────────────
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.colors.cardBgSolid,
          borderColor: t.colors.border,
          borderRadius: t.radius.lg,
          padding: t.spacing.md,
          gap: t.spacing.md,
          ...t.shadows.sm(t.colors.shadowColor),
        },
      ]}
    >
      <View style={[styles.headRow, { gap: t.spacing.sm }]}>
        <View style={[styles.titleBlock, { gap: t.spacing.xs }]}>
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} numberOfLines={2}>
            {place.name}
          </Text>
          {place.category ? (
            <View
              style={[
                styles.chip,
                {
                  backgroundColor: t.colors.bgMuted,
                  borderRadius: t.radius.pill,
                  paddingHorizontal: t.spacing.sm,
                },
              ]}
            >
              <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                {formatCategory(place.category)}
              </Text>
            </View>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${place.name} from the draft`}
          onPress={() => onToggleKept(place.localId)}
          hitSlop={8}
          style={({ pressed }) => [
            styles.removeBtn,
            { borderRadius: t.radius.sm, paddingHorizontal: t.spacing.sm },
            pressed && { backgroundColor: t.colors.dangerLight },
            Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
          ]}
        >
          <Text style={[t.typography.caption, { color: t.colors.danger, fontWeight: '600' }]}>
            Remove
          </Text>
        </Pressable>
      </View>

      <View style={[styles.controlsRow, { gap: t.spacing.md }]}>
        <View style={styles.durationWrap}>
          <VisitDurationStepper
            minutes={place.visitMinutes}
            onChange={(m) => onChangeMinutes(place.localId, m)}
            // The ai-itinerary Edge Function validates visit minutes to
            // 15..480 — keep edits inside the same window.
            maxMinutes={480}
          />
        </View>
        {dayCount > 1 ? (
          <Stepper
            compact
            showLabel
            label={`Day for ${place.name}`}
            value={place.dayHint}
            onChange={(day) => onChangeDay(place.localId, day)}
            min={1}
            max={dayCount}
            formatValue={(v) => `Day ${v}`}
          />
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  removedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 56,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  titleBlock: { flex: 1, alignItems: 'flex-start' },
  chip: { paddingVertical: 2 },
  removeBtn: {
    minHeight: 32,
    justifyContent: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
  durationWrap: { flexGrow: 1, flexBasis: 200, minWidth: 180 },
});
