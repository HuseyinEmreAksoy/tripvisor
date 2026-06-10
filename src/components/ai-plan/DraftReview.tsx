/**
 * DraftReview — stage 2 of the AI "Plan my trip" flow: the editable draft.
 *
 * UX bar (docs/v2/ux-principles.md): "AI produces editable drafts, never
 * locked itineraries". Nothing here touches the server — the parent commits
 * only when the user accepts. Per-place keep/remove (forgiving restore),
 * visit-duration edit, and Day reassign; unresolved groundings are surfaced
 * loudly, never silently dropped.
 *
 * State ownership: this component OWNS the edit state, seeded from `draft`.
 * The parent remounts it per run (`key={runId}`) so a fresh draft never
 * inherits stale edits. On accept it hands back a `DraftCommitPayload`.
 */
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AiDraft, AiRunStatus } from '@/api';
import { useTheme } from '@/theme';
import {
  Button,
  Heading,
  PoweredByGoogle,
  StatusPill,
  TextField,
  formatMinutes,
} from '@/components';
import { DraftPlaceCard } from './DraftPlaceCard';
import type { DraftCommitPayload, DraftPlaceEdit } from './types';

export interface DraftReviewProps {
  draft: AiDraft;
  status: AiRunStatus;
  /** Pre-filled trip title ("<Destination> · N days"), editable in the footer. */
  defaultTitle: string;
  /** Trip-creation failure bounced back from the commit stage (retry = Create again). */
  commitError?: Error | null;
  /** Back to stage 1 with a NEW idempotency key + cleared form. */
  onStartOver: () => void;
  onCommit: (payload: DraftCommitPayload) => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function DraftReview({
  draft,
  status,
  defaultTitle,
  commitError,
  onStartOver,
  onCommit,
}: DraftReviewProps) {
  const t = useTheme();
  const dayCount = clamp(Math.round(draft.dayCount) || 1, 1, 14);

  const [edits, setEdits] = useState<DraftPlaceEdit[]>(() =>
    draft.places.map((p, i) => ({
      localId: `${i}-${p.googlePlaceId}`,
      name: p.name,
      googlePlaceId: p.googlePlaceId,
      lat: p.lat,
      lng: p.lng,
      visitMinutes: clamp(p.visitMinutes, 15, 480),
      category: p.category,
      dayHint: clamp(p.dayHint, 1, dayCount),
      kept: true,
    })),
  );
  const [title, setTitle] = useState(defaultTitle);
  const [titleError, setTitleError] = useState<string | null>(null);

  // Stable handlers so the memoized cards only re-render when THEIR row changes.
  const onToggleKept = useCallback((localId: string) => {
    setEdits((prev) => prev.map((e) => (e.localId === localId ? { ...e, kept: !e.kept } : e)));
  }, []);
  const onChangeMinutes = useCallback((localId: string, visitMinutes: number) => {
    setEdits((prev) => prev.map((e) => (e.localId === localId ? { ...e, visitMinutes } : e)));
  }, []);
  const onChangeDay = useCallback(
    (localId: string, day: number) => {
      const next = clamp(day, 1, dayCount);
      setEdits((prev) => prev.map((e) => (e.localId === localId ? { ...e, dayHint: next } : e)));
    },
    [dayCount],
  );

  // Group by (possibly user-reassigned) day. Removed rows stay in their day
  // section so "restore" happens in context.
  const sections = useMemo(() => {
    const byDay: DraftPlaceEdit[][] = Array.from({ length: dayCount }, () => []);
    for (const e of edits) byDay[e.dayHint - 1]?.push(e);
    return byDay;
  }, [edits, dayCount]);

  const keptCount = useMemo(() => edits.filter((e) => e.kept).length, [edits]);
  const unresolvedCount = draft.unresolved.length;

  const handleCreate = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError('Give your trip a title');
      return;
    }
    if (trimmed.length > 120) {
      setTitleError('Keep the title under 120 characters');
      return;
    }
    onCommit({
      title: trimmed,
      places: edits
        .filter((e) => e.kept)
        .map((e) => ({
          name: e.name,
          googlePlaceId: e.googlePlaceId,
          lat: e.lat,
          lng: e.lng,
          visitMinutes: e.visitMinutes,
          category: e.category,
          dayHint: e.dayHint,
        })),
    });
  };

  const hasPlaces = edits.length > 0;

  return (
    <View style={{ gap: t.spacing.lg }}>
      {/* ── Header: expectation-setting — this is a draft, nothing saved ── */}
      <View
        style={{
          backgroundColor: t.colors.bgElevated,
          borderRadius: t.radius.xl,
          padding: t.spacing.xl,
          gap: t.spacing.sm,
          ...t.shadows.md(t.colors.shadowColor),
        }}
      >
        <StatusPill tone="info" label="Draft — nothing is saved yet" />
        <Text style={[t.typography.overline, { color: t.colors.primary }]}>
          AI trip planner
        </Text>
        <Heading level={2}>Your draft</Heading>
        {hasPlaces ? (
          <Text style={[t.typography.body, { color: t.colors.textMuted, lineHeight: 24 }]}>
            {edits.length} {edits.length === 1 ? 'place' : 'places'} across {dayCount}{' '}
            {dayCount === 1 ? 'day' : 'days'}. Keep, remove, or adjust anything — your trip is only
            created when you accept.
          </Text>
        ) : null}
        {draft.notes ? (
          <Text style={[t.typography.caption, { color: t.colors.textMuted, fontStyle: 'italic' }]}>
            AI note: {draft.notes}
          </Text>
        ) : null}
      </View>

      {/* ── Partial grounding: loud, never silent (plan-v2 N3) ───────────── */}
      {status === 'partial' || unresolvedCount > 0 ? (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{
            backgroundColor: t.colors.warningLight,
            borderRadius: t.radius.md,
            padding: t.spacing.md,
            gap: t.spacing.xs,
          }}
        >
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
            We couldn't find {unresolvedCount} {unresolvedCount === 1 ? 'place' : 'places'} —{' '}
            {unresolvedCount === 1 ? 'it' : 'they'} won't be added
          </Text>
          {draft.unresolved.map((name) => (
            <Text key={name} style={[t.typography.caption, { color: t.colors.textMuted }]}>
              • {name}
            </Text>
          ))}
          <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
            You can add them by hand from the trip screen later.
          </Text>
        </View>
      ) : null}

      {/* ── Day sections ──────────────────────────────────────────────────── */}
      {hasPlaces ? (
        sections.map((places, i) => {
          const kept = places.filter((p) => p.kept);
          const minutes = kept.reduce((sum, p) => sum + p.visitMinutes, 0);
          return (
            <View key={`day-${i + 1}`} style={{ gap: t.spacing.sm }}>
              <View style={styles.dayHeader}>
                <Heading level={3}>Day {i + 1}</Heading>
                <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
                  {kept.length} kept{kept.length > 0 ? ` · ${formatMinutes(minutes)}` : ''}
                </Text>
              </View>
              {places.length === 0 ? (
                <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
                  Nothing on this day yet — reassign a place here with its Day control.
                </Text>
              ) : (
                places.map((p) => (
                  <DraftPlaceCard
                    key={p.localId}
                    place={p}
                    dayCount={dayCount}
                    onToggleKept={onToggleKept}
                    onChangeMinutes={onChangeMinutes}
                    onChangeDay={onChangeDay}
                  />
                ))
              )}
            </View>
          );
        })
      ) : (
        <View
          style={{
            backgroundColor: t.colors.bgElevated,
            borderRadius: t.radius.md,
            padding: t.spacing.lg,
            gap: t.spacing.xs,
          }}
        >
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
            No places could be matched
          </Text>
          <Text style={[t.typography.caption, { color: t.colors.textMuted, lineHeight: 18 }]}>
            None of the AI's suggestions could be found on the map. Try a more specific destination
            or a different prompt.
          </Text>
        </View>
      )}

      {/* Draft names/coordinates are Google-grounded place data (ToS rule 4). */}
      {hasPlaces ? <PoweredByGoogle /> : null}

      {/* ── Footer: title + accept / start over ──────────────────────────── */}
      <View style={{ gap: t.spacing.sm }}>
        {hasPlaces ? (
          <>
            <TextField
              label="Trip title"
              value={title}
              onChangeText={(v) => {
                setTitle(v);
                if (titleError) setTitleError(null);
              }}
              maxLength={120}
              error={titleError}
            />
            <Text style={[t.typography.small, { color: t.colors.textMuted, lineHeight: 16 }]}>
              After creation the route optimizer fine-tunes the day split and visiting order — you
              can drag, reassign, and undo anything on the trip screen.
            </Text>
          </>
        ) : null}

        {commitError ? (
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={{
              backgroundColor: t.colors.dangerLight,
              borderRadius: t.radius.md,
              padding: t.spacing.md,
              gap: t.spacing.xs,
            }}
          >
            <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
              Couldn't create the trip
            </Text>
            <Text style={[t.typography.caption, { color: t.colors.textMuted, lineHeight: 18 }]}>
              {commitError.message} — nothing was saved. Your draft is still here; try Create again.
            </Text>
          </View>
        ) : null}

        {hasPlaces ? (
          <>
            <Button
              label={`Create trip with ${keptCount} ${keptCount === 1 ? 'place' : 'places'}`}
              onPress={handleCreate}
              disabled={keptCount === 0}
            />
            {keptCount === 0 ? (
              <Text
                style={[t.typography.caption, { color: t.colors.textMuted, textAlign: 'center' }]}
              >
                Restore at least one place to create the trip.
              </Text>
            ) : null}
          </>
        ) : null}
        <Button variant="ghost" label="← Start over" onPress={onStartOver} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
});
