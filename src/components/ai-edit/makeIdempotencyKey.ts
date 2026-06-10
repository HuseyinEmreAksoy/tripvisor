/**
 * makeIdempotencyKey — client copy of the (unexported) generator in
 * src/api/ai.ts, shared by the N4 AI sheets (mirrors the copy in
 * app/(app)/trip/plan.tsx). The fallback satisfies the ai-edit function's
 * 8..64-char idempotencyKey constraint.
 *
 * "Try again" UX contract (src/api/ai.ts): generate ONE key per user intent
 * (instruction / day+slack / names batch) and reuse it on every retry of that
 * intent — a timed-out-but-completed run then replays the stored result for
 * free instead of double-billing LLM + grounding quota.
 */
export function makeIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to fallback
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** One idempotency key per intent: minted when the signature changes. */
export interface IntentKey {
  key: string;
  signature: string;
}

/**
 * Returns `current` unchanged while the intent signature matches (so retries
 * replay server-side for free), otherwise mints a fresh key for the new
 * intent.
 */
export function keyForIntent(current: IntentKey | null, signature: string): IntentKey {
  if (current && current.signature === signature) return current;
  return { key: makeIdempotencyKey(), signature };
}
