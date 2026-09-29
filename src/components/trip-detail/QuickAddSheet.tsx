/**
 * QuickAddSheet — the FAB's action sheet on the trip detail route
 * (v2 M4 X2.2). Replaces the full-width "Add a place" bar:
 *
 *   Search a place  → /trip/[id]/add (optionally ?day=N)
 *   Paste a list    → ImportPlacesSheet (pasted list / Takeout CSV → Ideas)
 *   Ask AI          → AiEditSheet (instruction → reviewable diff → apply)
 *   Add expense     → ExpenseEditSheet (new expense)
 *   Discover nearby → /trip/[id]/discover (M5 Y3.4)
 *
 * Only mounted for editors (the route gates it on `canEditTrip`).
 *
 * The menu closes before the chosen sheet opens. On iOS a Modal can't
 * present while another is dismissing, so the hand-off waits for the slide
 * animation there; Android and web switch immediately.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet, Heading, Icon, type IconName } from '@/components';
import { AiEditSheet, ImportPlacesSheet } from '@/components/ai-edit';
import { ExpenseEditSheet } from '@/components/budget/ExpenseEditSheet';
import { useTheme } from '@/theme';
import { haptics } from '@/lib/haptics';
import { useT } from '@/i18n';
import type { RouteRenderMode, TripCurrency, TripPlace } from '@/api';
import { IOS_MODAL_HANDOFF_MS } from './modalHandoff';

type SubSheet = 'import' | 'ai' | 'expense';

export interface QuickAddSheetProps {
  visible: boolean;
  onClose: () => void;
  tripId: string;
  places: TripPlace[];
  routeRenderMode: RouteRenderMode;
  currency: TripCurrency;
  tripDayCount: number;
  tripStartDate: string | null;
  /** Navigate to the add-place search screen. */
  onSearch: () => void;
}

export function QuickAddSheet({
  visible,
  onClose,
  tripId,
  places,
  routeRenderMode,
  currency,
  tripDayCount,
  tripStartDate,
  onSearch,
}: QuickAddSheetProps) {
  const t = useTheme();
  const { t: tx } = useT(['discover']);
  const router = useRouter();
  const [sub, setSub] = useState<SubSheet | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function openSub(next: SubSheet) {
    haptics.tap();
    onClose();
    if (timer.current) clearTimeout(timer.current);
    if (Platform.OS === 'ios') {
      timer.current = setTimeout(() => setSub(next), IOS_MODAL_HANDOFF_MS);
    } else {
      setSub(next);
    }
  }

  const actions: Array<{ key: string; icon: IconName; label: string; hint: string; run: () => void }> = [
    {
      key: 'search',
      icon: 'search',
      label: 'Search a place',
      hint: 'Find restaurants, museums, viewpoints…',
      run: () => {
        haptics.tap();
        onClose();
        onSearch();
      },
    },
    {
      key: 'import',
      icon: 'file-text',
      label: 'Paste a list',
      hint: 'Paste names or a Google Takeout CSV into Ideas',
      run: () => openSub('import'),
    },
    {
      key: 'ai',
      icon: 'pencil',
      label: 'Ask AI',
      hint: 'Describe a change and review it before applying',
      run: () => openSub('ai'),
    },
    {
      key: 'expense',
      icon: 'wallet',
      label: 'Add expense',
      hint: 'Log what you spent, by category',
      run: () => openSub('expense'),
    },
    {
      key: 'discover',
      icon: 'compass',
      label: tx('quickAdd.label'),
      hint: tx('quickAdd.hint'),
      run: () => {
        haptics.tap();
        onClose();
        router.push(`/trip/${tripId}/discover`);
      },
    },
  ];

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} accessibilityLabel="Quick add">
        <Heading level={3}>Add to this trip</Heading>
        <View style={{ gap: t.spacing.xs }}>
          {actions.map((a) => (
            <Pressable
              key={a.key}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              accessibilityHint={a.hint}
              onPress={a.run}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? t.colors.bgMuted : 'transparent',
                  borderRadius: t.radius.md,
                  paddingHorizontal: t.spacing.sm,
                },
              ]}
            >
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: t.colors.gradientSubtle, borderRadius: t.radius.md },
                ]}
              >
                <Icon name={a.icon} size={20} color={t.colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>{a.label}</Text>
                <Text numberOfLines={1} style={[t.typography.caption, { color: t.colors.textMuted }]}>
                  {a.hint}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </BottomSheet>

      <ImportPlacesSheet
        visible={sub === 'import'}
        onClose={() => setSub(null)}
        tripId={tripId}
        places={places}
      />
      <AiEditSheet
        visible={sub === 'ai'}
        onClose={() => setSub(null)}
        tripId={tripId}
        places={places}
        routeRenderMode={routeRenderMode}
      />
      <ExpenseEditSheet
        tripId={tripId}
        expense={null}
        currency={currency}
        visible={sub === 'expense'}
        onClose={() => setSub(null)}
        tripDayCount={tripDayCount}
        tripStartDate={tripStartDate}
      />
    </>
  );
}

/** Floating action button that opens QuickAddSheet. */
export function QuickAddFab({ onPress, bottom }: { onPress: () => void; bottom: number }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Quick add"
      accessibilityHint="Add a place, paste a list, ask AI or log an expense"
      onPress={() => {
        haptics.impact();
        onPress();
      }}
      style={({ pressed }) => [
        styles.fab,
        {
          bottom,
          right: t.spacing.lg,
          backgroundColor: pressed ? t.colors.primaryDark : t.colors.primary,
          ...t.shadows.md(t.colors.shadowColorStrong),
        },
      ]}
    >
      <Icon name="plus" size={26} color={t.colors.primaryText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  iconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});
