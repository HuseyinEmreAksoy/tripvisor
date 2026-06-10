/**
 * GapFillSheet — "~Nh free — fill this day" (v2 Phase N4 step 4.2).
 *
 * Opens from the per-day slack chip in ItineraryTab. IDEAS FIRST: the user's
 * own saved-but-unscheduled places get one-tap "Add to Day N" (existing
 * useMoveToDay — zero API cost, and it cuts metered grounding calls, the
 * whole point of plan-v2 N4's "draws from Ideas first"). Below that, an
 * explicit "Ask AI for suggestions" button calls useAiSuggest for 0–4
 * grounded fill-ins that fit the spare minutes.
 *
 * Suggestions are TIER-2 DISPLAY ONLY until accepted: nothing is persisted
 * unless the user taps "Add" (then the normal useCreateTripPlace +
 * useMoveToDay run — durable fields only: name, place id, coords, minutes).
 * "Powered by Google" renders under the suggestions list (grounded data,
 * ToS rule 4). An empty suggestions array is the honest "Nothing fits this
 * gap." state, never an error.
 *
 * Day conventions: `dayIndex` here is the 0-BASED trip_places.day_index
 * (exactly what useAiSuggest expects as input); the returned dayHint is
 * 1-based but unused — added places go straight to THIS day's index.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import {
  useAiSuggest,
  useCreateTripPlace,
  useMoveToDay,
  type AiDraftPlace,
  type AiUsage,
  type TripPlace,
  type Uuid,
} from '@/api';
import { useTheme } from '@/theme';
import { BottomSheet, Button, Heading, PoweredByGoogle, StatusPill } from '@/components';
import { AiErrorNotice } from '@/components/ai-plan';
import { formatDuration } from '@/lib/formatDuration';
import { UnresolvedCard } from './UnresolvedCard';
import { keyForIntent, type IntentKey } from './makeIdempotencyKey';

export interface GapFillSheetProps {
  visible: boolean;
  onClose: () => void;
  tripId: Uuid;
  /** 0-based trip_places.day_index of the day being filled. */
  dayIndex: number;
  /** Spare minutes vs the daily budget, captured when the chip was tapped. */
  slackMinutes: number;
  /** Current Ideas-bucket places (day_index === null). */
  ideas: TripPlace[];
}

/** useAiSuggest validates slackMinutes to 30..480. */
function clampSlack(v: number): number {
  return Math.max(30, Math.min(480, Math.round(v)));
}

/** "art_gallery" → "Art gallery". */
function formatCategory(category: string): string {
  const cleaned = category.replace(/_/g, ' ').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

type AddState = 'adding' | 'added' | 'failed';

export function GapFillSheet({
  visible,
  onClose,
  tripId,
  dayIndex,
  slackMinutes,
  ideas,
}: GapFillSheetProps) {
  const t = useTheme();
  const suggest = useAiSuggest();
  const suggestReset = suggest.reset; // stable in TanStack Query v5
  const { mutateAsync: createPlaceAsync } = useCreateTripPlace();
  const { mutateAsync: moveToDayAsync } = useMoveToDay();

  const [usage, setUsage] = useState<AiUsage | null>(null);
  /** Per-suggestion add status, keyed by googlePlaceId. */
  const [addStates, setAddStates] = useState<ReadonlyMap<string, AddState>>(() => new Map());
  /** The idea currently being moved (disables the pills while in flight). */
  const [movingIdeaId, setMovingIdeaId] = useState<string | null>(null);
  /** Honest inline failure line for an idea move (row stays retappable). */
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const intentRef = useRef<IntentKey | null>(null);

  const dayNumber = dayIndex + 1;
  const slack = clampSlack(slackMinutes);

  // A different day (or a meaningfully different gap) is a different intent:
  // drop stale suggestions so Day 3's list never shows under Day 1's header.
  useEffect(() => {
    suggestReset();
    setAddStates(new Map());
    setIdeaError(null);
  }, [dayIndex, suggestReset]);

  const handleAsk = () => {
    intentRef.current = keyForIntent(intentRef.current, `${tripId}|${dayIndex}|${slack}`);
    suggest.mutate(
      { tripId, dayIndex, slackMinutes: slack, idempotencyKey: intentRef.current.key },
      { onSuccess: (res) => setUsage(res.usage) },
    );
  };

  const handleAddSuggestion = useCallback(
    async (s: AiDraftPlace) => {
      setAddStates((prev) => new Map(prev).set(s.googlePlaceId, 'adding'));
      try {
        const row = await createPlaceAsync({
          trip_id: tripId,
          google_place_id: s.googlePlaceId,
          user_title: s.name,
          category: s.category,
          lat: s.lat,
          lng: s.lng,
          visit_duration_minutes: Math.max(15, Math.min(480, Math.round(s.visitMinutes))),
        });
        try {
          // Suggestions carry dayHint = dayIndex + 1 (1-based); this sheet is
          // already scoped to that day, so we move straight to dayIndex.
          await moveToDayAsync({ id: row.id, tripId, toDayIndex: dayIndex });
        } catch (moveErr) {
          // Non-fatal: the place exists; the optimizer assigns it a day.
          console.warn(`[GapFillSheet] day assignment failed for "${s.name}"`, moveErr);
        }
        setAddStates((prev) => new Map(prev).set(s.googlePlaceId, 'added'));
      } catch (err) {
        console.warn(`[GapFillSheet] failed to add "${s.name}"`, err);
        setAddStates((prev) => new Map(prev).set(s.googlePlaceId, 'failed'));
      }
    },
    [createPlaceAsync, moveToDayAsync, tripId, dayIndex],
  );

  const handleMoveIdea = useCallback(
    async (idea: TripPlace) => {
      setMovingIdeaId(idea.id);
      setIdeaError(null);
      try {
        await moveToDayAsync({ id: idea.id, tripId, toDayIndex: dayIndex });
        // On success the place leaves the Ideas bucket, so its row disappears
        // from this list on the next render — visible feedback by itself.
      } catch (err) {
        console.warn(`[GapFillSheet] failed to move idea "${idea.user_title ?? idea.id}"`, err);
        setIdeaError(`Couldn't add ${idea.user_title ?? 'that place'} — tap to try again.`);
      } finally {
        setMovingIdeaId(null);
      }
    },
    [moveToDayAsync, tripId, dayIndex],
  );

  const suggestions = suggest.data?.suggestions ?? null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel={`Fill Day ${dayNumber} — ideas and AI suggestions`}
    >
      <View style={{ gap: t.spacing.xs }}>
        <Heading level={2}>{`Fill Day ${dayNumber}`}</Heading>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          ~{formatDuration(slack)} free before your daily time budget.
        </Text>
      </View>

      <ScrollView style={styles.bodyScroll} contentContainerStyle={{ gap: t.spacing.md }}>
        {/* ── Ideas first — the user's own list, zero API cost ───────────── */}
        <View style={{ gap: t.spacing.sm }}>
          <Text
            accessibilityRole="header"
            style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '700', letterSpacing: 0.3 }]}
          >
            From your Ideas
          </Text>
          {ideaError ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[t.typography.small, { color: t.colors.danger }]}
            >
              {ideaError}
            </Text>
          ) : null}
          {ideas.length === 0 ? (
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              No saved Ideas yet — places you save without scheduling land there.
            </Text>
          ) : (
            ideas.map((idea) => {
              const title = idea.user_title ?? 'Saved place';
              return (
                <View
                  key={idea.id}
                  style={[
                    styles.itemRow,
                    {
                      backgroundColor: t.colors.cardBgSolid,
                      borderColor: t.colors.border,
                      borderRadius: t.radius.md,
                      padding: t.spacing.md,
                      gap: t.spacing.sm,
                    },
                  ]}
                >
                  <View style={styles.itemText}>
                    <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} numberOfLines={1}>
                      {title}
                    </Text>
                    <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                      {formatDuration(idea.visit_duration_minutes)}
                    </Text>
                  </View>
                  <AddPill
                    label={`Add to Day ${dayNumber}`}
                    accessibilityLabel={`Add ${title} from your Ideas to Day ${dayNumber}`}
                    onPress={() => void handleMoveIdea(idea)}
                    disabled={movingIdeaId !== null}
                    pending={movingIdeaId === idea.id}
                  />
                </View>
              );
            })
          )}
        </View>

        {/* ── Then AI — explicit, costs a run, never automatic ────────────── */}
        <View style={{ gap: t.spacing.sm }}>
          <Text
            accessibilityRole="header"
            style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '700', letterSpacing: 0.3 }]}
          >
            Or ask AI
          </Text>

          {suggest.error ? (
            <AiErrorNotice
              error={suggest.error}
              dailyLimit={usage?.dailyLimit}
              onRetry={handleAsk}
              retryPending={suggest.isPending}
              quotaTitle={`You've used today's ${usage?.dailyLimit ?? 10} AI runs`}
              quotaBody="AI suggestions share the daily limit with trip planning and edits. It resets at midnight UTC."
              setupDocPath="supabase/functions/ai-edit/README.md"
            />
          ) : null}

          {suggestions === null ? (
            <>
              <Button
                variant="secondary"
                label="✨ Ask AI for suggestions"
                onPress={handleAsk}
                loading={suggest.isPending}
                accessibilityLabel={`Ask AI for places that fit the ${formatDuration(slack)} gap on Day ${dayNumber}`}
              />
              {suggest.isPending ? (
                <View style={styles.centerRow}>
                  <StatusPill loading label="Finding places that fit this gap…" />
                </View>
              ) : null}
            </>
          ) : suggestions.length === 0 ? (
            <View
              style={{
                backgroundColor: t.colors.bgElevated,
                borderRadius: t.radius.md,
                padding: t.spacing.md,
                gap: t.spacing.xs,
              }}
            >
              <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
                Nothing fits this gap
              </Text>
              <Text style={[t.typography.caption, { color: t.colors.textMuted, lineHeight: 18 }]}>
                The AI couldn't find anything nearby that fits in ~{formatDuration(slack)}. Try
                adding from your Ideas, or shorten a visit to make more room.
              </Text>
            </View>
          ) : (
            <>
              {suggestions.map((s) => {
                const state = addStates.get(s.googlePlaceId);
                return (
                  <View
                    key={s.googlePlaceId}
                    style={[
                      styles.itemRow,
                      {
                        backgroundColor: t.colors.cardBgSolid,
                        borderColor: t.colors.border,
                        borderRadius: t.radius.md,
                        padding: t.spacing.md,
                        gap: t.spacing.sm,
                      },
                    ]}
                  >
                    <View style={styles.itemText}>
                      <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} numberOfLines={2}>
                        {s.name}
                      </Text>
                      <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                        {formatDuration(s.visitMinutes)}
                        {s.category ? ` · ${formatCategory(s.category)}` : ''}
                      </Text>
                      {state === 'failed' ? (
                        <Text
                          accessibilityLiveRegion="polite"
                          style={[t.typography.small, { color: t.colors.danger }]}
                        >
                          Couldn't add — tap to try again
                        </Text>
                      ) : null}
                    </View>
                    <AddPill
                      label={state === 'added' ? 'Added ✓' : 'Add'}
                      accessibilityLabel={
                        state === 'added'
                          ? `${s.name} added to Day ${dayNumber}`
                          : `Add ${s.name} to Day ${dayNumber}`
                      }
                      onPress={() => void handleAddSuggestion(s)}
                      disabled={state === 'added' || state === 'adding'}
                      pending={state === 'adding'}
                      done={state === 'added'}
                    />
                  </View>
                );
              })}
              <UnresolvedCard
                names={suggest.data?.unresolved ?? []}
                title="A few suggestions couldn't be matched"
                hint="They were left out rather than guessed at."
              />
              {/* Suggestion names are Google-grounded data (ToS rule 4). */}
              <PoweredByGoogle />
            </>
          )}
        </View>
      </ScrollView>

      <Button variant="ghost" label="Done" onPress={onClose} />
    </BottomSheet>
  );
}

/** Compact inline action pill (full-size Button is too heavy inside rows). */
function AddPill({
  label,
  accessibilityLabel,
  onPress,
  disabled,
  pending,
  done,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  pending?: boolean;
  done?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled === true, busy: pending === true }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.addPill,
        {
          backgroundColor: done ? t.colors.successLight : t.colors.primary,
          borderRadius: t.radius.pill,
          paddingHorizontal: t.spacing.md,
          opacity: pending ? 0.6 : pressed ? 0.8 : 1,
        },
        Platform.OS === 'web' && ({ cursor: disabled ? 'default' : 'pointer' } as ViewStyle),
      ]}
    >
      <Text
        style={[
          t.typography.small,
          { color: done ? t.colors.success : t.colors.primaryText, fontWeight: '700' },
        ]}
      >
        {pending ? 'Adding…' : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Bounded so the list scrolls inside the sheet on both platforms;
  // conservative so the header + Done button still fit a 667pt phone.
  bodyScroll: { maxHeight: 340 },
  centerRow: { alignItems: 'center' },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    minHeight: 56,
  },
  itemText: { flex: 1, gap: 2 },
  addPill: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
