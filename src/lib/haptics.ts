/**
 * haptics — tiny, fire-and-forget wrapper over `expo-haptics` (v2 M4 X1.1).
 *
 *   haptics.tap();        // light tick: tab switch, chip toggle
 *   haptics.select();     // selection change: picker, drag pickup
 *   haptics.success();    // commit: check-off, saved
 *   haptics.warning();    // destructive confirm, blocked action
 *
 * - Web: no-op (no reliable haptics; never touches `navigator`).
 * - Honors the OS "reduce motion" preference — users who ask for less motion
 *   generally want less physical feedback too. The preference is read once
 *   and kept current via the AccessibilityInfo listener (no per-call await).
 * - Never throws: a missing native module or unsupported device is silent.
 */
import { AccessibilityInfo, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

let reduceMotion = false;
let subscribed = false;

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  AccessibilityInfo.isReduceMotionEnabled()
    .then((value) => {
      reduceMotion = value;
    })
    .catch(() => {
      // Preference unavailable — keep haptics on.
    });
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value) => {
    reduceMotion = value;
  });
}

function enabled(): boolean {
  if (Platform.OS === 'web') return false;
  ensureSubscribed();
  return !reduceMotion;
}

function run(fn: () => Promise<void>): void {
  if (!enabled()) return;
  fn().catch(() => {
    // Device without a haptic engine / module unavailable — ignore.
  });
}

export const haptics = {
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  impact: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  select: () => run(() => Haptics.selectionAsync()),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
} as const;
