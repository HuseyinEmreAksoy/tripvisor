/**
 * AiEditSheet — "✨ Edit with AI" as a PREVIEWABLE DIFF (v2 Phase N4 4.1).
 *
 * UX bar (docs/v2/ux-principles.md): AI never auto-applies. The flow is
 * staged inside one BottomSheet:
 *
 *   input    → natural-language instruction (5–1000 chars) → useAiEditTrip
 *   preview  → the diff grouped into Adds / Removes / Moves / Duration
 *              changes; EVERY row is an include/exclude checkbox (default
 *              included). Unresolved add-names get the amber card; an
 *              all-empty diff is the honest "Nothing to change" state.
 *   applying → useAiEditApply commits the included rows sequentially
 *              ("Applying i of n…"), then ONE optimize pass. Closing is
 *              blocked while writing (the one way to strand a half-applied
 *              edit).
 *   done     → result summary with partial-failure honesty and FIRST-CLASS
 *              "Undo these changes" (one tap, in-memory inverse, local to
 *              this sheet session).
 *   undone   → undo confirmation (with its own honesty about anything that
 *              couldn't be reverted).
 *
 * Idempotency: ONE key per instruction intent (useRef) — retrying after a
 * transient failure reuses the key so a completed-server-side run replays
 * free; editing the instruction mints a new key (same contract as plan.tsx).
 *
 * Server state: useAiEditTrip (preview, writes nothing) — commits go through
 * the normal trip-places hooks inside useAiEditApply.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  useAiEditTrip,
  type AiEditResult,
  type AiUsage,
  type RouteRenderMode,
  type TripPlace,
  type Uuid,
} from '@/api';
import { useTheme } from '@/theme';
import { useT } from '@/i18n';
import { BottomSheet, Button, Heading, PoweredByGoogle, StatusPill } from '@/components';
import { AiErrorNotice, PromptField } from '@/components/ai-plan';
import { useAiEditApply, type AiEditApplyOutcome, type AiEditUndoOutcome } from '@/hooks/useAiEditApply';
import { formatDuration } from '@/lib/formatDuration';
import { DiffRow } from './DiffRow';
import { UnresolvedCard } from './UnresolvedCard';
import { keyForIntent, type IntentKey } from './makeIdempotencyKey';
import type { AiEditOp } from './types';

export interface AiEditSheetProps {
  visible: boolean;
  onClose: () => void;
  tripId: Uuid;
  /** Current trip places — feeds "Day A →" labels and the undo snapshots. */
  places: TripPlace[];
  /** trip.route_render_mode — the final optimize pass respects it. */
  routeRenderMode: RouteRenderMode;
}

type Stage = 'input' | 'preview' | 'applying' | 'done' | 'undone';

const INSTRUCTION_MIN = 5;
const INSTRUCTION_MAX = 1000;

/** "art_gallery" → "Art gallery" (same formatting as DraftPlaceCard). */
function formatCategory(category: string): string {
  const cleaned = category.replace(/_/g, ' ').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** 0-based day_index (or null = Ideas) → user-facing label. */
function dayLabel(dayIndex: number | null): string {
  return dayIndex === null ? 'Ideas' : `Day ${dayIndex + 1}`;
}

export function AiEditSheet({
  visible,
  onClose,
  tripId,
  places,
  routeRenderMode,
}: AiEditSheetProps) {
  const t = useTheme();
  const { t: tx } = useT('ai');
  const edit = useAiEditTrip();
  const editApply = useAiEditApply();

  const [stage, setStage] = useState<Stage>('input');
  const [instruction, setInstruction] = useState('');
  const [instructionError, setInstructionError] = useState<string | null>(null);
  /** Row keys the user UNchecked (default = everything included). */
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [applyOutcome, setApplyOutcome] = useState<AiEditApplyOutcome | null>(null);
  const [undoOutcome, setUndoOutcome] = useState<AiEditUndoOutcome | null>(null);
  // ONE idempotency key per instruction intent (see header comment).
  const intentRef = useRef<IntentKey | null>(null);

  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  const result: AiEditResult | undefined = edit.data;
  const diff = result?.diff;
  const totalRows = diff
    ? diff.adds.length + diff.removes.length + diff.moves.length + diff.durationChanges.length
    : 0;
  const includedCount = totalRows - excluded.size;
  // Block closing only while WRITING — abandoning a preview is always safe.
  const writing = editApply.phase !== 'idle';

  const handleToggle = useCallback((rowKey: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }, []);

  const handleClose = useCallback(() => {
    if (writing) return; // never strand a half-applied edit
    onClose();
  }, [writing, onClose]);

  // ── input → preview ───────────────────────────────────────────────────────
  const handleSubmit = () => {
    const trimmed = instruction.trim();
    if (trimmed.length < INSTRUCTION_MIN) {
      setInstructionError('Tell the AI a little more — at least 5 characters');
      return;
    }
    if (trimmed.length > INSTRUCTION_MAX) {
      setInstructionError('Keep it under 1000 characters');
      return;
    }
    setInstructionError(null);
    intentRef.current = keyForIntent(intentRef.current, trimmed);
    edit.mutate(
      { tripId, instruction: trimmed, idempotencyKey: intentRef.current.key },
      {
        onSuccess: (res) => {
          setUsage(res.usage);
          setExcluded(new Set());
          setStage('preview');
        },
      },
    );
  };

  // ── preview → applying → done ────────────────────────────────────────────
  const handleApply = async () => {
    if (!result || includedCount === 0) return;
    const ops: AiEditOp[] = [];
    result.diff.adds.forEach((p, i) => {
      if (!excluded.has(`add-${i}`)) ops.push({ kind: 'add', place: p });
    });
    for (const r of result.diff.removes) {
      if (!excluded.has(`rm-${r.tripPlaceId}`))
        ops.push({ kind: 'remove', tripPlaceId: r.tripPlaceId, name: r.name });
    }
    for (const m of result.diff.moves) {
      if (!excluded.has(`mv-${m.tripPlaceId}`))
        ops.push({ kind: 'move', tripPlaceId: m.tripPlaceId, name: m.name, toDay: m.toDay });
    }
    for (const d of result.diff.durationChanges) {
      if (!excluded.has(`du-${d.tripPlaceId}`))
        ops.push({
          kind: 'duration',
          tripPlaceId: d.tripPlaceId,
          name: d.name,
          visitMinutes: d.visitMinutes,
        });
    }
    if (ops.length === 0) return;
    setStage('applying');
    const outcome = await editApply.apply({ tripId, places, ops, routeRenderMode });
    if (outcome) {
      // The trip changed: the same text must mint a NEW key next time, or the
      // server replays this (now stale) diff.
      intentRef.current = null;
      setApplyOutcome(outcome);
      setStage('done');
    } else {
      setStage('preview'); // re-entrancy guard tripped; nothing was started
    }
  };

  // ── done → undone (first-class, one tap) ─────────────────────────────────
  const handleUndo = async () => {
    const outcome = await editApply.undo();
    if (outcome) {
      intentRef.current = null; // undo re-created rows with new ids
      setUndoOutcome(outcome);
      setStage('undone');
    }
  };

  /**
   * Back to input keeping the typed text (the "nothing to change" preview).
   * Nothing was applied, so the intent key may still replay the same result.
   */
  const resetToInput = () => {
    edit.reset();
    setInstructionError(null);
    setExcluded(new Set());
    setApplyOutcome(null);
    setUndoOutcome(null);
    setStage('input');
  };

  /**
   * Fresh edit after an apply/undo: clears the result, instruction, intent key
   * (the trip changed, so a replayed diff would point at dead place ids) and
   * ends the undo window.
   */
  const resetForNewEdit = () => {
    resetToInput();
    intentRef.current = null;
    setInstruction('');
    editApply.clearUndo();
  };

  // The sheet stays mounted between opens: a close from done/undone ends the
  // session, so the next "Edit with AI" starts on a clean input and a stale
  // Undo can't revert manual changes made after the sheet was dismissed.
  const sessionOver = !visible && !writing && (stage === 'done' || stage === 'undone');
  const resetRef = useRef(resetForNewEdit);
  resetRef.current = resetForNewEdit;
  useEffect(() => {
    if (sessionOver) resetRef.current();
  }, [sessionOver]);

  const remainingRuns = usage ? Math.max(0, usage.dailyLimit - usage.runsToday) : null;
  const quotaProps = {
    quotaTitle: `You've used today's ${usage?.dailyLimit ?? 10} AI runs`,
    quotaBody:
      'AI edits share the daily limit with trip planning and suggestions. It resets at midnight UTC — nothing was changed.',
    setupDocPath: 'supabase/functions/ai-edit/README.md',
  } as const;

  return (
    <BottomSheet visible={visible} onClose={handleClose} accessibilityLabel="Edit trip with AI">
      {/* ── Stage: input ─────────────────────────────────────────────────── */}
      {stage === 'input' ? (
        <View style={{ gap: t.spacing.md }}>
          <Heading level={2}>✨ Edit with AI</Heading>
          <Text style={[t.typography.caption, { color: t.colors.textMuted, lineHeight: 18 }]}>
            Describe the change in plain language. You'll see every proposed change and approve it
            before anything is applied — and you can undo right after.
          </Text>
          <PromptField
            label="What should change?"
            value={instruction}
            onChangeText={(v) => {
              setInstruction(v);
              if (instructionError) setInstructionError(null);
            }}
            placeholder={'"make day 2 less packed", "swap the museum for something outdoors"'}
            maxLength={INSTRUCTION_MAX}
            minHeight={96}
            error={instructionError}
          />
          {edit.error ? (
            <AiErrorNotice
              error={edit.error}
              dailyLimit={usage?.dailyLimit}
              onRetry={handleSubmit}
              retryPending={edit.isPending}
              {...quotaProps}
            />
          ) : null}
          <Button
            label="✨ Preview changes"
            onPress={handleSubmit}
            loading={edit.isPending}
            accessibilityLabel="Preview the AI's proposed changes — nothing is applied yet"
          />
          {edit.isPending ? (
            <View style={styles.centerRow}>
              <StatusPill loading label="Working out the changes — usually 10–20 seconds" />
            </View>
          ) : remainingRuns !== null ? (
            <Text style={[t.typography.small, { color: t.colors.textMuted, textAlign: 'center' }]}>
              {remainingRuns} of {usage?.dailyLimit} AI runs left today
            </Text>
          ) : null}
          <Button variant="ghost" label="Cancel" onPress={handleClose} />
        </View>
      ) : null}

      {/* ── Stage: preview ───────────────────────────────────────────────── */}
      {stage === 'preview' && result && diff ? (
        totalRows === 0 ? (
          <View style={{ gap: t.spacing.md }}>
            <Heading level={2}>Nothing to change</Heading>
            <View
              style={{
                backgroundColor: t.colors.bgElevated,
                borderRadius: t.radius.md,
                padding: t.spacing.md,
                gap: t.spacing.xs,
              }}
            >
              <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
                Nothing to change for that request
              </Text>
              <Text style={[t.typography.caption, { color: t.colors.textMuted, lineHeight: 18 }]}>
                {diff.notes ??
                  'Your trip already matches, or the request needs a little more detail.'}
              </Text>
            </View>
            <UnresolvedCard
              names={result.unresolved}
              hint="They couldn't be matched to real places, so there was nothing to add."
            />
            <Button label="Try a different instruction" onPress={resetToInput} />
            <Button variant="ghost" label="Close" onPress={handleClose} />
          </View>
        ) : (
          <View style={{ gap: t.spacing.md }}>
            <View style={{ gap: t.spacing.xs }}>
              <StatusPill tone="info" label="Preview — nothing is applied yet" />
              <Heading level={2}>Proposed changes</Heading>
              {diff.notes ? (
                <Text
                  style={[t.typography.caption, { color: t.colors.textMuted, fontStyle: 'italic' }]}
                >
                  AI note: {diff.notes}
                </Text>
              ) : null}
            </View>

            <ScrollView style={styles.diffScroll} contentContainerStyle={{ gap: t.spacing.sm }}>
              <UnresolvedCard
                names={result.unresolved}
                hint="They won't be added — you can search for them by hand from Add place."
              />

              {diff.adds.length > 0 ? (
                <SectionLabel>{`Adds (${diff.adds.length})`}</SectionLabel>
              ) : null}
              {diff.adds.map((p, i) => (
                <DiffRow
                  key={`add-${i}-${p.googlePlaceId}`}
                  rowKey={`add-${i}`}
                  title={p.name}
                  detail={`${formatDuration(p.visitMinutes)}${p.category ? ` · ${formatCategory(p.category)}` : ''}`}
                  chip={`Day ${p.dayHint}`}
                  included={!excluded.has(`add-${i}`)}
                  onToggle={handleToggle}
                />
              ))}

              {diff.removes.length > 0 ? (
                <SectionLabel>{`Removes (${diff.removes.length})`}</SectionLabel>
              ) : null}
              {diff.removes.map((r) => (
                <DiffRow
                  key={`rm-${r.tripPlaceId}`}
                  rowKey={`rm-${r.tripPlaceId}`}
                  title={r.name}
                  detail={`Remove from ${dayLabel(byId.get(r.tripPlaceId)?.day_index ?? null)}`}
                  tone="remove"
                  included={!excluded.has(`rm-${r.tripPlaceId}`)}
                  onToggle={handleToggle}
                />
              ))}

              {diff.moves.length > 0 ? (
                <SectionLabel>{`Moves (${diff.moves.length})`}</SectionLabel>
              ) : null}
              {diff.moves.map((m) => (
                <DiffRow
                  key={`mv-${m.tripPlaceId}`}
                  rowKey={`mv-${m.tripPlaceId}`}
                  title={m.name}
                  detail={`${dayLabel(byId.get(m.tripPlaceId)?.day_index ?? null)} → Day ${m.toDay}`}
                  included={!excluded.has(`mv-${m.tripPlaceId}`)}
                  onToggle={handleToggle}
                />
              ))}

              {diff.durationChanges.length > 0 ? (
                <SectionLabel>{`Duration changes (${diff.durationChanges.length})`}</SectionLabel>
              ) : null}
              {diff.durationChanges.map((d) => {
                const before = byId.get(d.tripPlaceId)?.visit_duration_minutes;
                return (
                  <DiffRow
                    key={`du-${d.tripPlaceId}`}
                    rowKey={`du-${d.tripPlaceId}`}
                    title={d.name}
                    detail={`${before !== undefined ? formatDuration(before) : '—'} → ${formatDuration(d.visitMinutes)}`}
                    included={!excluded.has(`du-${d.tripPlaceId}`)}
                    onToggle={handleToggle}
                  />
                );
              })}

              {/* Add-names are Google-grounded place data (ToS rule 4). */}
              {diff.adds.length > 0 ? <PoweredByGoogle /> : null}
            </ScrollView>

            <View style={{ gap: t.spacing.sm }}>
              <Button
                label={`Apply ${includedCount} ${includedCount === 1 ? 'change' : 'changes'}`}
                onPress={() => void handleApply()}
                disabled={includedCount === 0}
                accessibilityLabel={`Apply the ${includedCount} checked ${includedCount === 1 ? 'change' : 'changes'}`}
              />
              <Text style={[t.typography.small, { color: t.colors.textMuted, textAlign: 'center' }]}>
                {includedCount === 0
                  ? 'Check at least one change to apply.'
                  : 'Unchecked changes are skipped. You can undo right after.'}
              </Text>
              <Button variant="ghost" label="Cancel" onPress={handleClose} />
            </View>
          </View>
        )
      ) : null}

      {/* ── Stage: applying ──────────────────────────────────────────────── */}
      {stage === 'applying' ? (
        <View style={[styles.progressBlock, { gap: t.spacing.md, padding: t.spacing.lg }]}>
          <StatusPill loading label="Applying your changes" />
          <Text
            accessibilityLiveRegion="polite"
            style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center' }]}
          >
            {editApply.phase === 'optimizing'
              ? 'Re-optimizing your route…'
              : `Applying ${Math.min(editApply.done + 1, Math.max(1, editApply.total))} of ${editApply.total}…`}
          </Text>
          <Text style={[t.typography.small, { color: t.colors.textMuted, textAlign: 'center' }]}>
            A few seconds — you'll get a chance to undo right after.
          </Text>
        </View>
      ) : null}

      {/* ── Stage: done (apply summary + first-class undo) ───────────────── */}
      {stage === 'done' && applyOutcome ? (
        <View style={{ gap: t.spacing.md }}>
          <View style={styles.centerRow}>
            <StatusPill
              tone={applyOutcome.applied > 0 ? 'success' : 'danger'}
              label={
                applyOutcome.applied > 0
                  ? `Applied ${applyOutcome.applied} ${applyOutcome.applied === 1 ? 'change' : 'changes'}`
                  : 'Nothing was applied'
              }
            />
          </View>

          {applyOutcome.failures.length > 0 ? (
            <View
              accessibilityRole="alert"
              style={{
                backgroundColor: t.colors.warningLight,
                borderRadius: t.radius.md,
                padding: t.spacing.md,
                gap: t.spacing.xs,
              }}
            >
              <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
                {applyOutcome.failures.length}{' '}
                {applyOutcome.failures.length === 1 ? 'change' : 'changes'} didn't apply
              </Text>
              {applyOutcome.failures.map((f) => (
                <Text key={f.label} style={[t.typography.caption, { color: t.colors.textMuted }]}>
                  • {f.label} — {f.message}
                </Text>
              ))}
              <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                Everything else landed. You can finish these by hand from the itinerary.
              </Text>
            </View>
          ) : null}

          {writing ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center' }]}
            >
              {editApply.phase === 'optimizing'
                ? 'Re-optimizing your route…'
                : `Undoing ${Math.min(editApply.done + 1, Math.max(1, editApply.total))} of ${editApply.total}…`}
            </Text>
          ) : null}

          {applyOutcome.canUndo ? (
            <Button
              variant="secondary"
              label="Undo these changes"
              onPress={() => void handleUndo()}
              loading={writing}
              accessibilityLabel="Undo these changes — restore the trip to how it was before this edit"
            />
          ) : null}
          <Button label="Done" onPress={handleClose} disabled={writing} />
          <Button
            variant="ghost"
            label={tx('edit.startNew')}
            onPress={resetForNewEdit}
            disabled={writing}
            accessibilityLabel={tx('edit.startNewA11y')}
          />
        </View>
      ) : null}

      {/* ── Stage: undone ────────────────────────────────────────────────── */}
      {stage === 'undone' && undoOutcome ? (
        <View style={{ gap: t.spacing.md }}>
          <View style={styles.centerRow}>
            <StatusPill tone="success" label="Changes undone" />
          </View>
          <Text
            style={[t.typography.caption, { color: t.colors.textMuted, textAlign: 'center', lineHeight: 18 }]}
          >
            {undoOutcome.reverted} {undoOutcome.reverted === 1 ? 'change' : 'changes'} reverted.
          </Text>
          {undoOutcome.failures.length > 0 ? (
            <View
              accessibilityRole="alert"
              style={{
                backgroundColor: t.colors.warningLight,
                borderRadius: t.radius.md,
                padding: t.spacing.md,
                gap: t.spacing.xs,
              }}
            >
              <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
                {undoOutcome.failures.length} couldn't be undone
              </Text>
              {undoOutcome.failures.map((f) => (
                <Text key={f.label} style={[t.typography.caption, { color: t.colors.textMuted }]}>
                  • {f.label} — {f.message}
                </Text>
              ))}
            </View>
          ) : null}
          <Button label="Close" onPress={handleClose} />
          <Button variant="ghost" label="Start a new edit" onPress={resetForNewEdit} />
        </View>
      ) : null}
    </BottomSheet>
  );
}

/** Compact group label above each diff section. */
function SectionLabel({ children }: { children: string }) {
  const t = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[
        t.typography.caption,
        { color: t.colors.textMuted, fontWeight: '700', letterSpacing: 0.3 },
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  centerRow: { alignItems: 'center' },
  // Bounded so long diffs scroll INSIDE the sheet on both platforms (the
  // native BottomSheet caps at 80% height but doesn't scroll its children);
  // conservative so header + footer still fit a 667pt phone.
  diffScroll: { maxHeight: 280 },
  progressBlock: { alignItems: 'center' },
});
