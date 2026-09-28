/**
 * DayJumpStrip — horizontal "Ideas · D1 Mon 12 · D2 Tue 13 …" chip strip
 * above the itinerary (v2 M4 X2.3).
 *
 * Rendered OUTSIDE the itinerary scroll view (never a sticky list header —
 * sticky headers inside a DraggableFlatList are unreliable on native), so it
 * stays pinned for free. Tapping a chip asks the parent to scroll to that
 * day. Today's chip is filled; the chip for the section currently in view
 * is outlined and kept scrolled into view inside the strip.
 *
 * `trailing` renders after the chips (the "✨ Assist" button) so the whole
 * top bar is one row on phones.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
// Direct types import: keeps the map runtime out of this module graph.
import { dayColor } from '@/components/Map/types';
import type { DayChip } from './dayChips';

export interface DayJumpStripProps {
  chips: DayChip[];
  /** Section currently in view (outlined). */
  activeDayIndex: number | null;
  onJump: (dayIndex: number) => void;
  trailing?: ReactNode;
}

export function DayJumpStrip({ chips, activeDayIndex, onJump, trailing }: DayJumpStripProps) {
  const t = useTheme();
  const stripRef = useRef<ScrollView>(null);
  const chipX = useRef(new Map<number, number>());

  // Keep the active chip visible inside the strip as the list scrolls.
  useEffect(() => {
    if (activeDayIndex === null) return;
    const x = chipX.current.get(activeDayIndex);
    if (x === undefined) return;
    stripRef.current?.scrollTo({ x: Math.max(0, x - 48), animated: false });
  }, [activeDayIndex]);

  if (chips.length <= 1 && !trailing) return null;

  return (
    <View
      style={[
        styles.bar,
        {
          paddingLeft: t.spacing.lg,
          paddingRight: trailing ? t.spacing.sm : t.spacing.lg,
          paddingVertical: t.spacing.xs,
          borderBottomColor: t.colors.border,
          backgroundColor: t.colors.bg,
        },
      ]}
    >
      {chips.length > 1 ? (
        <ScrollView
          ref={stripRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={[styles.stripContent, { gap: t.spacing.xs }]}
          accessibilityRole="tablist"
          accessibilityLabel="Jump to a day"
        >
          {chips.map((chip) => {
            const active = chip.dayIndex === activeDayIndex;
            return (
              <Pressable
                key={chip.dayIndex}
                onLayout={(e) => chipX.current.set(chip.dayIndex, e.nativeEvent.layout.x)}
                accessibilityRole="tab"
                accessibilityLabel={`Jump to ${chip.accessibilityLabel}`}
                accessibilityState={{ selected: active }}
                onPress={() => onJump(chip.dayIndex)}
                hitSlop={{ top: 4, bottom: 4 }}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderRadius: t.radius.pill,
                    paddingHorizontal: t.spacing.md,
                    backgroundColor: chip.isToday ? t.colors.primary : t.colors.bgElevated,
                    borderColor: active
                      ? t.colors.primary
                      : chip.isToday
                        ? t.colors.primary
                        : t.colors.border,
                    borderWidth: active ? 2 : 1,
                    opacity: pressed ? 0.7 : 1,
                  },
                  Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
                ]}
              >
                <View
                  style={[styles.dot, { backgroundColor: dayColor(chip.dayIndex) }]}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text
                  numberOfLines={1}
                  style={[
                    t.typography.small,
                    {
                      fontWeight: chip.isToday || active ? '700' : '600',
                      color: chip.isToday
                        ? t.colors.primaryText
                        : chip.isPast
                          ? t.colors.textMuted
                          : t.colors.text,
                    },
                  ]}
                >
                  {chip.isToday ? `${chip.label} · Today` : chip.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <View style={styles.strip} />
      )}
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  strip: { flex: 1 },
  stripContent: { alignItems: 'center', paddingVertical: 2 },
  chip: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
