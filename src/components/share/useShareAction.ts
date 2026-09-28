/**
 * useShareAction — wraps the platform `shareLink` helper with transient
 * feedback state so every share button behaves the same way:
 * "Link copied" when the web fallback copied instead of sharing, and a
 * polite error when nothing worked. Pure UI state; no data fetching.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { shareLink, type ShareLinkInput, type ShareOutcome } from './shareSheet';

const FEEDBACK_MS = 2500;

export function shareFeedbackMessage(outcome: ShareOutcome | null): string | null {
  switch (outcome) {
    case 'copied':
      return 'Link copied to clipboard';
    case 'failed':
      return "Couldn't open sharing — copy the link instead.";
    default:
      return null;
  }
}

export function useShareAction() {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const [sharing, setSharing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const share = useCallback(async (input: ShareLinkInput): Promise<ShareOutcome> => {
    setSharing(true);
    try {
      const result = await shareLink(input);
      setOutcome(result);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setOutcome(null), FEEDBACK_MS);
      return result;
    } finally {
      setSharing(false);
    }
  }, []);

  return { share, sharing, outcome, feedback: shareFeedbackMessage(outcome) };
}
