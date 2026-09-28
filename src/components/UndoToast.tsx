/**
 * UndoToast — global undo affordance for Tier-1 sync mutations (v2 S2.8.8).
 *
 * Mounted ONCE in app/(app)/_layout.tsx so it floats above every signed-in
 * screen on all three platforms. Subscribes to the session UndoStack
 * (src/sync/undo.ts): a PUSH — detected as a version tick whose size did NOT
 * shrink, because the version counter alone also ticks on undo/clear, while
 * a strict size-growth check misses a push at capacity (oldest evicted →
 * size flat) and a batched pop+push (S2.8.13 F3 hardening) — shows the
 * entry label plus an Undo pill for ~6 s. Pressing Undo runs
 * `stack.undoLast()` and reports "Undid: <label>"; a throwing inverse stays
 * popped by design (see the undo.ts header — the world changed underneath
 * it), so the toast shows a brief "Couldn't undo" instead of blind-retrying.
 *
 * Renders nothing while the Tier-1 sync flag is off (src/sync/flags.ts):
 * undo entries are only produced by sync mutations, so flag-off keeps the
 * v1 experience byte-identical.
 *
 * Placement: bottom-center on phones (lifted above the home indicator via
 * safe-area insets), bottom-LEFT on desktop web (≥768 px — a centered toast
 * stretched across a wide viewport reads as a blocking dialog). Animation
 * is the codebase's native-driven Animated fade+rise (Button/EmptyState
 * precedent), skipped entirely under reduced motion.
 *
 * Accessibility: the message Text lives in an `accessibilityLiveRegion=
 * "polite"` container (aria-live on web), the Undo action is a real button
 * with a ≥44 px touch target, and the host wrapper is pointerEvents
 * "box-none" so the rest of the screen stays interactive.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { isTier1SyncEnabled } from '@/sync/flags';
import { useUndo } from '@/sync/undo';

/** How long the actionable toast stays up before auto-dismissing. */
const UNDOABLE_VISIBLE_MS = 6_000;
/** Confirmation ("Undid: …") linger. */
const UNDONE_VISIBLE_MS = 2_500;
/** Failure ("Couldn't undo …") linger — a touch longer so it can be read. */
const ERROR_VISIBLE_MS = 4_000;
/** Same desktop cutoff the trip screens use for web layout decisions. */
const DESKTOP_BREAKPOINT = 768;

type Phase = 'undoable' | 'undoing' | 'undone' | 'error';

interface ToastContent {
  phase: Phase;
  /** The UndoEntry label ("Remove place", "Reorder", …). */
  label: string;
}

export function UndoToast() {
  const t = useTheme();
  const stack = useUndo();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [toast, setToast] = useState<ToastContent | null>(null);
  // 0 = hidden, 1 = shown. Native-driven opacity + translateY.
  const anim = useRef(new Animated.Value(0)).current;
  const prevSizeRef = useRef(stack.size);
  const prevVersionRef = useRef(stack.getVersion());
  /** True while OUR undoLast() is in flight — its pop must not be mistaken
   * for an external clear (sign-out) in the change-detection effect below.
   * Belt-and-braces only since F3: the phase check there is the primary
   * guard (this ref resets in a microtask, which can lose the race against
   * React's passive-effect flush when an inverse resolves fast). */
  const undoInFlightRef = useRef(false);

  const animateIn = useCallback(() => {
    if (reducedMotion) {
      anim.setValue(1);
      return;
    }
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [anim, reducedMotion]);

  const dismiss = useCallback(() => {
    if (reducedMotion) {
      anim.setValue(0);
      setToast(null);
      return;
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: 160,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(({ finished }) => {
      // A new push can interrupt the exit animation — only unmount when the
      // exit actually completed.
      if (finished) setToast(null);
    });
  }, [anim, reducedMotion]);

  // Push detection (S2.8.13 F3 hardening). useUndo() re-renders on every
  // stack change; the version guard makes runs triggered by anything other
  // than a stack change (dep identity churn, our own setToast re-renders)
  // explicit no-ops, which in turn makes it safe to read `toast` here.
  //
  // The stack's only version-ticking ops are push() and a non-empty
  // undoLast()/clear(), so for a changed version:
  //   size >= prev  ⟹ at least one push landed (strict growth misses a push
  //                   at capacity — oldest evicted, size flat — and a
  //                   batched pop+push netting to equal size; both showed
  //                   NO toast under the old `size > prev` check).
  //   size <  prev  ⟹ pure shrink: our own undoLast() or an external clear.
  const version = stack.getVersion();
  useEffect(() => {
    const size = stack.size;
    const prevSize = prevSizeRef.current;
    const versionChanged = version !== prevVersionRef.current;
    prevSizeRef.current = size;
    prevVersionRef.current = version;
    if (!versionChanged) return;
    if (size >= prevSize) {
      setToast({ phase: 'undoable', label: stack.peekLabel ?? 'Last change' });
      animateIn();
    } else if (
      !undoInFlightRef.current &&
      (toast === null || toast.phase === 'undoable')
    ) {
      // External shrink (e.g. a sign-out clear) while an ACTIONABLE toast is
      // up: its entry no longer exists, so drop it immediately (no exit
      // motion). The 'undoing'/'undone'/'error' phases are deliberately left
      // alone — handleUndo owns that lifecycle, and our own pop's shrink
      // must never kill the confirmation it is about to show (the in-flight
      // ref alone was racy: it resets in a microtask, which can beat the
      // passive-effect flush when an inverse resolves synchronously-fast).
      anim.setValue(0);
      setToast(null);
    }
  }, [version, stack, anim, animateIn, toast]);

  // Auto-dismiss, phase-dependent. 'undoing' never auto-dismisses — the
  // async inverse resolves to 'undone'/'error', which restarts this timer
  // (the toast object identity changes on every setToast).
  useEffect(() => {
    if (!toast || toast.phase === 'undoing') return undefined;
    const ms =
      toast.phase === 'undoable'
        ? UNDOABLE_VISIBLE_MS
        : toast.phase === 'undone'
          ? UNDONE_VISIBLE_MS
          : ERROR_VISIBLE_MS;
    const id = setTimeout(dismiss, ms);
    return () => clearTimeout(id);
  }, [toast, dismiss]);

  const handleUndo = useCallback(async () => {
    undoInFlightRef.current = true;
    setToast((current) => (current ? { phase: 'undoing', label: current.label } : current));
    try {
      const entry = await stack.undoLast();
      // Guard with the phase: if a NEW push landed mid-flight (rare race),
      // its 'undoable' toast wins over our confirmation.
      setToast((current) =>
        current?.phase === 'undoing'
          ? entry
            ? { phase: 'undone', label: entry.label }
            : null
          : current,
      );
    } catch {
      // A throwing inverse stays popped by design (undo.ts header) — the row
      // was likely changed/tombstoned remotely. Surface it; don't retry.
      setToast((current) =>
        current?.phase === 'undoing' ? { phase: 'error', label: current.label } : current,
      );
    } finally {
      undoInFlightRef.current = false;
    }
  }, [stack]);

  // Flag off → invisible (hooks above ran unconditionally). Pushes only
  // happen flag-on, so this is belt-and-braces against stale state.
  if (!isTier1SyncEnabled()) return null;
  if (!toast) return null;

  const isDesktopWeb = Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
  const hasTrailingAction = toast.phase === 'undoable' || toast.phase === 'undoing';

  let message: string;
  switch (toast.phase) {
    case 'undoable':
    case 'undoing':
      message = toast.label;
      break;
    case 'undone':
      message = `Undid: ${toast.label}`;
      break;
    case 'error':
      message = `Couldn't undo "${toast.label}"`;
      break;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.host,
        // position:'fixed' guards against any future scroll-container parent
        // on web — same cast precedent as BottomSheet.web.tsx.
        Platform.OS === 'web' && webFixedHost,
        {
          paddingBottom: insets.bottom + t.spacing.lg,
          paddingHorizontal: t.spacing.lg,
        },
        isDesktopWeb ? styles.hostLeft : styles.hostCenter,
      ]}
    >
      <Animated.View
        // Polite announce: VoiceOver/TalkBack/screen readers read the label
        // when the toast appears and again on "Undid:"/"Couldn't undo".
        accessibilityLiveRegion="polite"
        style={[
          styles.toast,
          {
            backgroundColor: t.colors.bgElevated,
            borderColor: t.colors.border,
            borderRadius: t.radius.pill,
            paddingLeft: t.spacing.lg,
            paddingRight: hasTrailingAction ? t.spacing.xs : t.spacing.lg,
            ...t.shadows.lg(t.colors.shadowColorStrong),
          },
          {
            opacity: anim,
            transform: [
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            ],
          },
        ]}
      >
        <Text
          style={[
            t.typography.bodyStrong,
            {
              color: toast.phase === 'error' ? t.colors.danger : t.colors.text,
              flexShrink: 1,
            },
          ]}
          numberOfLines={2}
        >
          {message}
        </Text>

        {toast.phase === 'undoable' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Undo ${toast.label}`}
            onPress={handleUndo}
            hitSlop={4}
            // styles.action enforces the 44px minimum touch target.
            style={({ pressed }) => [
              styles.action,
              { borderRadius: t.radius.pill, paddingHorizontal: t.spacing.md },
              pressed && { backgroundColor: t.colors.gradientSubtle },
              Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
            ]}
          >
            <Text style={[t.typography.bodyStrong, { color: t.colors.primaryInk, letterSpacing: 0.2 }]}>
              Undo
            </Text>
          </Pressable>
        ) : null}

        {toast.phase === 'undoing' ? (
          <View style={styles.action} accessible accessibilityLabel="Undoing">
            <ActivityIndicator size="small" color={t.colors.primary} />
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

// Valid CSS on React Native Web; cast bypasses the RN type system, which only
// knows 'absolute' | 'relative' | 'static'. Same pattern as BottomSheet.web.
const webFixedHost = {
  position: 'fixed' as unknown as 'absolute',
} as ViewStyle;

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Above screen content AND above BottomSheet (zIndex 100): an undo toast
    // must stay reachable even when an actions sheet re-opens beneath it.
    zIndex: 120,
  },
  hostCenter: { alignItems: 'center' },
  hostLeft: { alignItems: 'flex-start' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingVertical: 4,
    maxWidth: 420,
    borderWidth: 1,
  },
  action: {
    // 44px minimum touch target (WCAG 2.5.8 / Apple HIG).
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
