/**
 * /trip/plan — "Plan my trip with AI" (v2 Phase N3, steps 3.4 + 3.5).
 *
 * One route, staged locally (no URL change between stages):
 *
 *   form       → prompt form: destination, days (1–14), free-text prompt,
 *                transport mode, "✨ Draft my trip". Quota shown when known;
 *                errors via <AiErrorNotice> (quota / setup-banner / retry).
 *   review     → <DraftReview>: the EDITABLE draft (keep/remove/restore,
 *                visit minutes, Day reassign, partial-grounding card).
 *                Nothing is saved until the user accepts.
 *   committing → <CommitProgress>: create trip → add places ("i of n") →
 *                one optimize pass (useAiDraftCommit).
 *   success    → <CommitSuccess>: first-class "Undo — delete this trip";
 *                auto-opens /trip/[id]?aiCreated=1 after a short beat when
 *                every place landed (failures pause auto-open and are listed).
 *   discarded  → undo confirmation ("Draft discarded"), then back to /trips.
 *
 * Idempotency contract (src/api/ai.ts): ONE key per planning intent, reused
 * on every retry of that intent so a timed-out-but-completed run replays the
 * stored draft for free. We key the intent by a signature of the submitted
 * inputs — resubmitting unchanged inputs (including after "← Edit request")
 * reuses the key; editing them or "← Start over" mints a new one.
 *
 * Static segment beats the dynamic sibling: /trip/plan resolves here, never
 * to /trip/[id] with id="plan" (same precedence /trip/new already relies on).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  BackButton,
  Button,
  EmptyState,
  Heading,
  Screen,
  StatusPill,
  TextField,
} from '@/components';
import {
  AiErrorNotice,
  CommitProgress,
  CommitSuccess,
  DraftReview,
  PromptField,
  Stepper,
  TransportModeRadio,
  type DraftCommitPayload,
} from '@/components/ai-plan';
import { useDeleteTrip, useGenerateItinerary, type AiUsage } from '@/api';
import { useAiDraftCommit } from '@/hooks/useAiDraftCommit';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';

// ── Form schema (client mirror of the ai-itinerary input contract) ─────────
const FormSchema = z.object({
  destination: z
    .string()
    .trim()
    .min(1, 'Where are you going?')
    .max(120, 'Keep the destination under 120 characters'),
  days: z.number().int().min(1).max(14),
  prompt: z
    .string()
    .trim()
    .min(10, 'Tell us a little more — at least 10 characters')
    .max(2000, 'Keep it under 2000 characters'),
  transport_mode: z.enum(['driving', 'walking', 'bicycling', 'transit']),
});

type FormValues = z.infer<typeof FormSchema>;

const DEFAULT_VALUES: FormValues = {
  destination: '',
  days: 3,
  prompt: '',
  transport_mode: 'driving',
};

type Stage = 'form' | 'review' | 'committing' | 'success' | 'discarded';

// Desktop ≥1024 gets a centered column instead of a stretched mobile screen.
const DESKTOP_MAX_WIDTH = 680;
// How long the success state stays before auto-opening the trip (the undo beat).
const SUCCESS_BEAT_MS = 2600;
// How long "Draft discarded" stays before returning to /trips.
const DISCARD_REDIRECT_MS = 1800;

// Mirrors makeIdempotencyKey in src/api/ai.ts (not exported there); the
// fallback satisfies the server's 8..64-char constraint.
function makeIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to fallback
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** "Lisbon" + 5 → "Lisbon · 5 days", clipped to the 120-char title limit. */
function deriveDefaultTitle(destination: string, dayCount: number): string {
  const suffix = ` · ${dayCount} ${dayCount === 1 ? 'day' : 'days'}`;
  const dest = destination.trim() || 'My trip';
  const maxDest = 120 - suffix.length;
  const clipped = dest.length > maxDest ? `${dest.slice(0, maxDest - 1)}…` : dest;
  return `${clipped}${suffix}`;
}

export default function PlanMyTrip() {
  const t = useTheme();
  const router = useRouter();
  const isDesktop = useBreakpoint() === 'desktop';

  const [stage, setStage] = useState<Stage>('form');
  // Last-known per-user quota (echoed by every successful run).
  const [usage, setUsage] = useState<AiUsage | null>(null);
  // ONE idempotency key per planning intent (see header comment).
  const intentRef = useRef<{ key: string; signature: string } | null>(null);
  const commitInFlightRef = useRef(false);
  const [successInfo, setSuccessInfo] = useState<{
    tripId: string;
    title: string;
    placesAdded: number;
    failures: string[];
  } | null>(null);
  const [undoPhase, setUndoPhase] = useState<'none' | 'pending' | 'failed'>('none');

  const generate = useGenerateItinerary();
  const draftCommit = useAiDraftCommit();
  const deleteTrip = useDeleteTrip();

  const {
    control,
    handleSubmit,
    getValues,
    reset: resetForm,
    setError: setFormError,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: DEFAULT_VALUES, mode: 'onBlur' });

  // 1.8: never strand the user — back falls back to Home when there's no
  // history (e.g. direct URL entry on web).
  const goHome = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/trips');
  }, [router]);

  // ── Stage 1: submit (same key for retries of the same intent) ────────────
  const onSubmit = (values: FormValues) => {
    const parsed = FormSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        setFormError(issue.path[0] as keyof FormValues, { message: issue.message });
      }
      return;
    }
    const signature = [parsed.data.destination, parsed.data.days, parsed.data.prompt].join('␟');
    if (!intentRef.current || intentRef.current.signature !== signature) {
      intentRef.current = { key: makeIdempotencyKey(), signature };
    }
    generate.mutate(
      {
        prompt: parsed.data.prompt,
        days: parsed.data.days,
        destination: parsed.data.destination,
        idempotencyKey: intentRef.current.key,
      },
      {
        onSuccess: (res) => {
          setUsage(res.usage);
          setStage('review');
        },
      },
    );
  };
  const submit = handleSubmit(onSubmit);

  // ── Stage 2 → 1: start over = fresh form + NEW idempotency key ───────────
  const handleStartOver = useCallback(() => {
    intentRef.current = null;
    generate.reset();
    resetForm(DEFAULT_VALUES);
    setStage('form');
    // generate is a new object each render but reset() is stable; listing the
    // mutation itself would re-create this callback every render for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetForm]);

  // ── Stage 2 → 3: commit the accepted draft ────────────────────────────────
  const handleCommit = useCallback(
    async (payload: DraftCommitPayload) => {
      const result = generate.data;
      if (!result || commitInFlightRef.current) return;
      commitInFlightRef.current = true;
      setStage('committing');
      try {
        const outcome = await draftCommit.commit({
          title: payload.title,
          transportMode: getValues('transport_mode'),
          dayCount: result.draft.dayCount,
          places: payload.places,
        });
        if (outcome) {
          setSuccessInfo({
            tripId: outcome.tripId,
            title: payload.title,
            placesAdded: payload.places.length - outcome.failures.length,
            failures: outcome.failures,
          });
          setUndoPhase('none');
          setStage('success');
        } else {
          // Trip creation failed — nothing saved; bounce back to the draft
          // with the error (draftCommit.error) rendered by DraftReview.
          setStage('review');
        }
      } finally {
        commitInFlightRef.current = false;
      }
    },
    [draftCommit, generate.data, getValues],
  );

  // ── Stage success: auto-open after the undo beat (clean commits only) ────
  useEffect(() => {
    if (stage !== 'success' || !successInfo) return;
    if (successInfo.failures.length > 0 || undoPhase !== 'none') return;
    const timer = setTimeout(() => {
      router.replace(`/trip/${successInfo.tripId}?aiCreated=1`);
    }, SUCCESS_BEAT_MS);
    return () => clearTimeout(timer);
  }, [stage, successInfo, undoPhase, router]);

  const handleOpenTrip = useCallback(() => {
    if (!successInfo) return;
    router.replace(`/trip/${successInfo.tripId}?aiCreated=1`);
  }, [router, successInfo]);

  // ── Undo: delete the just-created trip, confirm, return to /trips ────────
  const handleUndo = useCallback(async () => {
    if (!successInfo || undoPhase === 'pending') return;
    setUndoPhase('pending'); // flips the auto-open effect off immediately
    try {
      await deleteTrip.mutateAsync(successInfo.tripId);
      setStage('discarded');
    } catch {
      setUndoPhase('failed');
    }
    // deleteTrip.mutateAsync is stable in TanStack Query v5.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [successInfo, undoPhase, deleteTrip.mutateAsync]);

  useEffect(() => {
    if (stage !== 'discarded') return;
    const timer = setTimeout(() => router.replace('/trips'), DISCARD_REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [stage, router]);

  // ── Layout helpers ────────────────────────────────────────────────────────
  const desktopWrap: ViewStyle | null = isDesktop
    ? { maxWidth: DESKTOP_MAX_WIDTH, alignSelf: 'center', width: '100%' }
    : null;
  const remainingPlans = usage ? Math.max(0, usage.dailyLimit - usage.runsToday) : null;
  const result = generate.data;
  const showReview = stage === 'review' && result;

  return (
    <Screen padded={false}>
      {/* Explicit back affordance for the interactive stages (1.8). */}
      {stage === 'form' || showReview ? (
        <View style={[{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.lg }, desktopWrap]}>
          {stage === 'form' ? (
            <BackButton onPress={goHome} label="Home" />
          ) : (
            <BackButton onPress={() => setStage('form')} label="Edit request" />
          )}
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { padding: t.spacing.lg, gap: t.spacing.lg },
          desktopWrap,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Stage 1: prompt form ─────────────────────────────────────────── */}
        {stage === 'form' ? (
          <>
            {/* v2 redesign: premium hero card — elevated surface, sparkle tile,
                muted overline above the bold display heading. */}
            <View
              style={{
                backgroundColor: t.colors.bgElevated,
                borderRadius: t.radius.xl,
                padding: t.spacing.xl,
                gap: t.spacing.sm,
                ...t.shadows.md(t.colors.shadowColor),
              }}
            >
              <View style={styles.bannerRow}>
                <View
                  style={[styles.sparkleTile, { backgroundColor: t.colors.gradientSubtle }]}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  aria-hidden
                >
                  <Text style={{ fontSize: 26 }}>✨</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[t.typography.overline, { color: t.colors.primary }]}>
                    AI trip planner
                  </Text>
                  <Heading level={1}>Plan my trip with AI</Heading>
                </View>
              </View>
              <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
                Describe the trip you want. AI drafts a day-by-day plan with real places — you
                review and edit every stop before anything is saved.
              </Text>
            </View>

            <Controller
              control={control}
              name="destination"
              render={({ field: { value, onChange, onBlur } }) => (
                <TextField
                  label="Destination"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  placeholder="e.g. Lisbon"
                  maxLength={120}
                  error={errors.destination?.message ?? null}
                />
              )}
            />

            <Controller
              control={control}
              name="days"
              render={({ field: { value, onChange } }) => (
                <Stepper
                  label="How many days?"
                  value={value}
                  onChange={onChange}
                  min={1}
                  max={14}
                  formatValue={(v) => `${v} ${v === 1 ? 'day' : 'days'}`}
                />
              )}
            />

            <Controller
              control={control}
              name="prompt"
              render={({ field: { value, onChange, onBlur } }) => (
                <PromptField
                  label="Describe your trip"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  placeholder={'"Relaxed pace, great food, one museum max…"'}
                  maxLength={2000}
                  hint="Pace, food, must-sees, things to avoid — anything goes."
                  error={errors.prompt?.message ?? null}
                />
              )}
            />

            <Controller
              control={control}
              name="transport_mode"
              render={({ field: { value, onChange } }) => (
                <TransportModeRadio value={value} onChange={onChange} />
              )}
            />

            {generate.error ? (
              <AiErrorNotice
                error={generate.error}
                dailyLimit={usage?.dailyLimit}
                onRetry={() => void submit()}
                retryPending={generate.isPending}
              />
            ) : null}

            <View style={{ gap: t.spacing.sm }}>
              <Button
                label="✨ Draft my trip"
                onPress={() => void submit()}
                loading={generate.isPending}
              />
              {generate.isPending ? (
                <View style={styles.centerRow}>
                  <StatusPill loading label="Drafting your trip — usually 10–20 seconds" />
                </View>
              ) : remainingPlans !== null ? (
                <Text
                  style={[t.typography.small, { color: t.colors.textMuted, textAlign: 'center' }]}
                >
                  {remainingPlans} of {usage?.dailyLimit} AI plans left today
                </Text>
              ) : null}
            </View>
          </>
        ) : null}

        {/* ── Stage 2: editable draft review ──────────────────────────────── */}
        {showReview && result ? (
          <DraftReview
            key={result.runId}
            draft={result.draft}
            status={result.status}
            defaultTitle={deriveDefaultTitle(getValues('destination'), result.draft.dayCount)}
            commitError={draftCommit.error}
            onStartOver={handleStartOver}
            onCommit={(payload) => void handleCommit(payload)}
          />
        ) : null}

        {/* ── Stage 3: commit progress / success / discarded ──────────────── */}
        {stage === 'committing' ? (
          <CommitProgress
            phase={draftCommit.phase === 'idle' ? 'creating' : draftCommit.phase}
            added={draftCommit.added}
            total={draftCommit.total}
          />
        ) : null}

        {stage === 'success' && successInfo ? (
          <CommitSuccess
            title={successInfo.title}
            placesAdded={successInfo.placesAdded}
            failures={successInfo.failures}
            autoOpening={successInfo.failures.length === 0 && undoPhase === 'none'}
            onOpen={handleOpenTrip}
            onUndo={() => void handleUndo()}
            undoPending={undoPhase === 'pending'}
            undoError={undoPhase === 'failed' ? deleteTrip.error : null}
          />
        ) : null}

        {stage === 'discarded' ? (
          <EmptyState
            icon={
              <Text style={{ fontSize: 48 }} aria-hidden>
                🧹
              </Text>
            }
            title="Draft discarded"
            body="The trip was deleted — nothing is saved. Taking you back to your trips…"
            ctaLabel="Back to your trips"
            onPress={() => router.replace('/trips')}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1 },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sparkleTile: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerRow: { alignItems: 'center' },
});
