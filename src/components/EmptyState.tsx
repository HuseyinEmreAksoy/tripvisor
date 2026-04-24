/**
 * EmptyState — centered card shown whenever a list or detail resolves empty.
 *
 * Usage (plain):
 *   <EmptyState title="No trips yet" body="Start by adding a destination." ctaLabel="New trip" onPress={handler} />
 *
 * Usage (legacy — still supported for existing callers):
 *   <EmptyState title="..." description="..." action={<Button />} />
 *
 * A11y: the wrapping View carries accessibilityRole="summary" so screen readers
 * announce the empty state as a landmark. On web, useRef + focus() moves focus
 * to the title on mount so keyboard-only users do not need to tab past the now-
 * absent list. On native the role itself surfaces the element appropriately.
 */
import { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { useTheme } from '@/theme';

export interface EmptyStateProps {
  title: string;
  /** Subtitle / explanatory copy. Alias: description (legacy). */
  body?: string;
  /** @deprecated Use body instead. */
  description?: string;
  /** Label for the primary CTA button. Only shown when onPress is also provided. */
  ctaLabel?: string;
  /** Handler for the primary CTA. */
  onPress?: () => void;
  /** Optional leading icon node rendered above the title. */
  icon?: React.ReactNode;
  /**
   * @deprecated Pass ctaLabel + onPress instead of a custom action node.
   * Kept for backward-compatibility with existing callers that supply a <Button />.
   */
  action?: React.ReactNode;
}

export function EmptyState({
  title,
  body,
  description,
  ctaLabel,
  onPress,
  icon,
  action,
}: EmptyStateProps) {
  const t = useTheme();
  const titleRef = useRef<Text>(null);

  const bodyText = body ?? description;

  // Move focus to the title on mount so keyboard-only web users skip past
  // the now-absent list content and immediately hear the empty state message.
  // On web we only steal focus when nothing else is currently focused
  // (document.activeElement === document.body), which prevents focus jumps
  // when the empty state is nested inside a tab panel that the user is already
  // navigating with the keyboard (WCAG 2.4.3 — focus order).
  // On native the document object is undefined; keep the existing unconditional
  // behavior because native focus management is handled differently by the OS.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // Early-return when another element already holds focus (web-only guard).
    if (
      typeof document !== 'undefined' &&
      document.activeElement !== document.body
    ) {
      return;
    }
    // RN Web maps Text to a <span>; .focus() is available on the underlying DOM node.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (titleRef.current as any)?.focus?.();
  }, []);

  return (
    <View
      style={[styles.root, { padding: t.spacing.xl, gap: t.spacing.md }]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={bodyText ? `${title}. ${bodyText}` : title}
    >
      {icon ? <View style={styles.iconWrapper}>{icon}</View> : null}

      <Text
        ref={titleRef}
        style={[t.typography.title, { color: t.colors.text, textAlign: 'center' } as TextStyle]}
        accessibilityRole="header"
      >
        {title}
      </Text>

      {bodyText ? (
        <Text
          style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center' }]}
        >
          {bodyText}
        </Text>
      ) : null}

      {/* New-style CTA */}
      {ctaLabel && onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: t.colors.primary,
              borderRadius: t.radius.md,
              paddingHorizontal: t.spacing.lg,
              paddingVertical: t.spacing.sm,
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Text style={[t.typography.bodyStrong, { color: t.colors.primaryText }]}>
            {ctaLabel}
          </Text>
        </Pressable>
      ) : null}

      {/* Legacy action node */}
      {action ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconWrapper: { alignItems: 'center' },
  cta: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
});
