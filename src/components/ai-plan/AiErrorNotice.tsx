/**
 * AiErrorNotice — maps AI-hook failures (`useGenerateItinerary`, and the N4
 * `useAiEditTrip` / `useAiSuggest` / `useGroundPlaces`) to the right surface.
 *
 *   - `quota_exceeded`   → friendly "out of quota for today" card, no retry
 *   - `ai_misconfigured` → setup banner (same pattern as the places
 *                          server_misconfigured banner in trip/[id]/add.tsx)
 *   - `llm_failed` / `upstream_timeout` / `db_error` / plain network errors
 *                        → "That didn't work — Try again". The caller MUST
 *                          retry with the SAME idempotency key (see ai.ts):
 *                          if the run actually completed server-side, the
 *                          retry replays the stored result for free.
 *   - anything else      → generic error card, no retry (retrying an
 *                          invalid_input / not_authenticated changes nothing)
 *
 * Copy overrides (v2 N4): the quota title/body and the setup-banner README
 * path default to the original "Plan my trip" wording; the AI-edit, gap-fill
 * and import sheets pass their own (e.g. "AI edits share the daily limit
 * with planning", ai-edit/README.md). Defaults keep N3 callers unchanged.
 *
 * Usage:
 *   <AiErrorNotice error={mutation.error} dailyLimit={usage?.dailyLimit}
 *                  onRetry={resubmitSameIntent} retryPending={mutation.isPending} />
 */
import { StyleSheet, Text, View } from 'react-native';
import { AiError } from '@/api';
import { useTheme } from '@/theme';
import { Button } from '@/components';

export interface AiErrorNoticeProps {
  error: Error;
  /** Last-known daily quota ceiling, for friendly copy. Defaults to 10. */
  dailyLimit?: number;
  /** Re-submits the same planning intent (same idempotency key). */
  onRetry: () => void;
  retryPending?: boolean;
  /** Override the quota-card title. Default: "You've used today's N AI plans". */
  quotaTitle?: string;
  /** Override the quota-card body copy. */
  quotaBody?: string;
  /** README path named in the setup banner. Default: the ai-itinerary one. */
  setupDocPath?: string;
}

const RETRYABLE_CODES = new Set(['llm_failed', 'upstream_timeout', 'db_error']);

export function AiErrorNotice({
  error,
  dailyLimit = 10,
  onRetry,
  retryPending,
  quotaTitle,
  quotaBody,
  setupDocPath = 'supabase/functions/ai-itinerary/README.md',
}: AiErrorNoticeProps) {
  const t = useTheme();
  const code = error instanceof AiError ? error.code : null;

  // ── Quota exhausted: friendly, terminal for today, no retry ──────────────
  if (code === 'quota_exceeded') {
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
          {quotaTitle ?? `You've used today's ${dailyLimit} AI plans`}
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted, lineHeight: 18 }]}>
          {quotaBody ??
            'Your quota resets at midnight UTC. Nothing was lost — come back tomorrow, or build this trip by hand from your trips screen.'}
        </Text>
      </View>
    );
  }

  // ── Server missing its keys: setup banner (mirrors the maps banner) ──────
  if (code === 'ai_misconfigured') {
    return (
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          styles.card,
          styles.setupBanner,
          {
            backgroundColor: t.colors.bgElevated,
            borderLeftColor: t.colors.warning,
            borderRadius: t.radius.md,
            padding: t.spacing.md,
          },
        ]}
      >
        <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
          AI integration needs setup
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted, marginTop: t.spacing.xs }]}>
          AI isn't configured on this server — see{' '}
          <Text style={{ fontFamily: 'monospace', color: t.colors.text }}>{setupDocPath}</Text> to
          set up the LLM and grounding keys.
        </Text>
      </View>
    );
  }

  // ── Transient: retry with the SAME idempotency key ───────────────────────
  if (code === null || RETRYABLE_CODES.has(code)) {
    const detail =
      code === 'upstream_timeout'
        ? 'The request timed out before the draft came back.'
        : code === 'llm_failed'
          ? 'The AI provider had a hiccup.'
          : code === 'db_error'
            ? 'The server stumbled while saving the run.'
            : 'We couldn’t reach the server.';
    return (
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          styles.card,
          {
            backgroundColor: t.colors.dangerLight,
            borderRadius: t.radius.md,
            padding: t.spacing.md,
            gap: t.spacing.sm,
          },
        ]}
      >
        <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>That didn't work</Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted, lineHeight: 18 }]}>
          {detail} Your request is kept — if the draft already finished on the server, trying again
          returns it instantly.
        </Text>
        <Button
          variant="secondary"
          label="Try again"
          onPress={onRetry}
          loading={retryPending}
          accessibilityLabel="Try drafting the trip again"
        />
      </View>
    );
  }

  // ── Everything else: honest message, no retry button ─────────────────────
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.card,
        {
          backgroundColor: t.colors.dangerLight,
          borderRadius: t.radius.md,
          padding: t.spacing.md,
          gap: t.spacing.xs,
        },
      ]}
    >
      <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>Something went wrong</Text>
      <Text style={[t.typography.caption, { color: t.colors.textMuted, lineHeight: 18 }]}>
        {error.message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'stretch' },
  setupBanner: { borderLeftWidth: 3 },
});
