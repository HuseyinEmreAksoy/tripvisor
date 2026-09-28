/**
 * /trip/[id]/packing — packing checklist for a trip (v2 Phase P2.2).
 *
 * Surfaces:
 *   - Header: back affordance + trip title + "7 of 23 packed" progress bar.
 *   - Checklist grouped by category (seed categories first, custom next,
 *     "Other" last — groupPackingItems). Check/uncheck is OPTIMISTIC
 *     (useUpdateTripPackingItem), delete is confirm-gated (confirmDestructive
 *     → useDeleteTripPackingItem).
 *   - "✨ Suggest items": seedPackingList(trip month, day count, rainy?) →
 *     existing labels filtered out case-insensitively → ONE bulk insert with
 *     auto:true. Seeded rows render a subtle "(suggested)" tag.
 *   - Add-item row (label + optional category chips) → single-item create.
 *
 * Role gating: writes require canEditTrip (useTripRole); viewers get the
 * read-only checklist. RLS enforces the same server-side — the UI gate just
 * keeps the affordances honest.
 *
 * Weather input: `hasRainyDay` reuses the SAME useDayWeather query as the
 * itinerary tab (identical params → identical query key → cache hit, no
 * second upstream call). When the forecast isn't loadable it stays
 * undefined and the seed simply skips rain gear.
 *
 * Desktop: content max-width 720, centered (collaborators pattern).
 *
 * v2 M4 X2.4 usability pass: accessible progress bar (+ "all packed" state),
 * a "Hide packed" switch, collapsible categories with per-category progress
 * (PackingCategorySection), one-tap suggestion chips (PackingSuggestionChips;
 * "Add all" keeps the bulk seed), haptic tick on toggle (PackingItemRow),
 * and skeleton loading. Hide/collapse state is per-visit (no storage).
 */
import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeBack } from '@/hooks/useSafeBack';
import { BackButton, Button, Icon, KeyboardAvoid, Screen } from '@/components';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTripRole } from '@/hooks/useTripRole';
import {
  isRainy,
  useCreateTripPackingItems,
  useDayWeather,
  useDeleteTripPackingItem,
  useTrip,
  useTripPackingItems,
  useTripPlaces,
  useUpdateTripPackingItem,
  type TripPackingItem,
} from '@/api';
import { seedPackingList, type PackingSeedItem } from '@/lib/packingSeed';
import { haptics } from '@/lib/haptics';
import { confirmDestructive } from '@/lib/confirm';
import {
  buildTripWeatherParams,
  monthOfDateString,
} from '@/components/trip-detail/tripWeather';
import { groupPackingItems } from '@/components/packing/groupPackingItems';
import { PackingCategorySection } from '@/components/packing/PackingCategorySection';
import { PackingSuggestionChips } from '@/components/packing/PackingSuggestionChips';
import { pendingSuggestions, viewPackingGroups } from '@/components/packing/packingView';
import { AddPackingItemRow } from '@/components/packing/AddPackingItemRow';

const PACKING_MAX_WIDTH = 720;
const MAX_SUGGESTION_CHIPS = 8;

export default function PackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const goBack = useSafeBack(`/trip/${id}`);
  const t = useTheme();
  const isDesktop = useBreakpoint() === 'desktop';

  const { data: trip, isLoading: tripLoading } = useTrip(id);
  const { data: places = [] } = useTripPlaces(id);
  const { canEditTrip } = useTripRole(id);
  const {
    data: items = [],
    isLoading: itemsLoading,
    error: itemsError,
  } = useTripPackingItems(id);
  const createItems = useCreateTripPackingItems();
  const updateItem = useUpdateTripPackingItem();
  const deleteItem = useDeleteTripPackingItem();

  // Transient feedback for the suggest action (success / nothing-new / error).
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [hidePacked, setHidePacked] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // ── Trip shape inputs for the seed ────────────────────────────────────────
  const maxDayIndex = useMemo(
    () =>
      places.reduce(
        (max, p) => (p.day_index !== null && p.day_index > max ? p.day_index : max),
        -1,
      ),
    [places],
  );

  // Day count: explicit trip dates win; otherwise the scheduled-day span;
  // floor 1 so the seed's clothing math always has something to work with.
  const tripDayCount = useMemo(() => {
    if (trip?.start_date && trip?.end_date) {
      const diff = Math.round(
        (new Date(trip.end_date).getTime() - new Date(trip.start_date).getTime()) / 86_400_000,
      );
      if (Number.isFinite(diff) && diff >= 0) return diff + 1;
    }
    return Math.max(1, maxDayIndex + 1);
  }, [trip?.start_date, trip?.end_date, maxDayIndex]);

  // ── hasRainyDay (same query key as ItineraryTab → cache hit) ─────────────
  const weatherParams = useMemo(
    () =>
      buildTripWeatherParams({
        tripStartDate: trip?.start_date ?? null,
        places,
        maxDayIndex,
      }),
    [trip?.start_date, places, maxDayIndex],
  );
  const { data: weatherDays } = useDayWeather(weatherParams);
  // undefined (not false) when no forecast loaded — the seed treats unknown
  // and known-dry the same way, but the distinction is honest.
  const hasRainyDay = weatherDays ? weatherDays.some(isRainy) : undefined;

  // ── Derived list state ────────────────────────────────────────────────────
  const groups = useMemo(() => groupPackingItems(items), [items]);
  const groupViews = useMemo(() => viewPackingGroups(groups, hidePacked), [groups, hidePacked]);
  const checkedCount = useMemo(() => items.filter((i) => i.checked).length, [items]);

  // Template suggestions not yet on the list (pure, offline).
  const pending = useMemo(() => {
    const startMonth =
      (trip?.start_date ? monthOfDateString(trip.start_date) : null) ?? new Date().getMonth() + 1;
    return pendingSuggestions(seedPackingList({ startMonth, days: tripDayCount, hasRainyDay }), items);
  }, [trip?.start_date, tripDayCount, hasRainyDay, items]);

  function toggleCollapsed(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  async function handleSuggest() {
    if (!id) return;
    setSuggestNote(null);
    const fresh = pending;
    if (fresh.length === 0) {
      setSuggestNote('Your list already covers everything we would suggest.');
      return;
    }
    try {
      await createItems.mutateAsync({
        tripId: id,
        items: fresh.map((s) => ({ label: s.label, category: s.category, auto: true })),
      });
      haptics.success();
      setSuggestNote(`Added ${fresh.length} suggested item${fresh.length === 1 ? '' : 's'}.`);
    } catch {
      setSuggestNote("Couldn't add suggestions — try again.");
    }
  }

  async function handleAddSuggestion(s: PackingSeedItem) {
    if (!id) return;
    setSuggestNote(null);
    try {
      await createItems.mutateAsync({ tripId: id, items: [{ label: s.label, category: s.category, auto: true }] });
      haptics.tap();
    } catch {
      setSuggestNote(`Couldn't add ${s.label} — try again.`);
    }
  }

  async function handleAdd(input: { label: string; category: string | null }) {
    if (!id) throw new Error('missing trip id');
    await createItems.mutateAsync({ tripId: id, items: [input] });
  }

  async function handleDelete(item: TripPackingItem) {
    if (!id) return;
    const confirmed = await confirmDestructive({
      title: 'Remove item?',
      message: `Remove "${item.label}" from your packing list?`,
      confirmLabel: 'Remove',
    });
    if (confirmed) deleteItem.mutate({ itemId: item.id, tripId: id });
  }

  // ── Loading / not-found shells ────────────────────────────────────────────
  if (tripLoading || itemsLoading) {
    return (
      <Screen>
        <SkeletonGroup label="Loading packing list" style={{ gap: t.spacing.md }}>
          <Skeleton width="50%" height={28} />
          <Skeleton height={8} radius="pill" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={48} />
          ))}
        </SkeletonGroup>
      </Screen>
    );
  }

  if (!trip) {
    return (
      <Screen>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>Trip not found.</Text>
        <Button label="Back to trips" onPress={() => router.replace('/trips')} />
      </Screen>
    );
  }

  const progressPct = items.length > 0 ? Math.round((checkedCount / items.length) * 100) : 0;
  const allPacked = items.length > 0 && checkedCount === items.length;

  return (
    <Screen padded={false}>
      <KeyboardAvoid>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            { padding: t.spacing.lg, gap: t.spacing.lg },
            isDesktop && { maxWidth: PACKING_MAX_WIDTH, alignSelf: 'center', width: '100%' },
          ]}
        >
          <BackButton onPress={goBack} label="Trip" />

          {/* ── Header: title + progress ─────────────────────────────────── */}
          <View style={{ gap: t.spacing.xs }}>
            <View style={styles.titleRow}>
              <Icon name="luggage" size={26} color={t.colors.primary} />
              <Text
                style={[t.typography.title, { color: t.colors.text, flexShrink: 1 }]}
                accessibilityRole="header"
                aria-level={1}
              >
                Packing list
              </Text>
            </View>
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{trip.title}</Text>
            {items.length > 0 ? (
              <View style={{ gap: t.spacing.xs, paddingTop: t.spacing.xs }}>
                <View style={styles.progressHead}>
                  <View style={styles.progressLabel}>
                    {allPacked ? <Icon name="circle-check" size={16} color={t.colors.success} /> : null}
                    <Text
                      style={[t.typography.caption, { color: allPacked ? t.colors.success : t.colors.text, fontWeight: '600', flexShrink: 1 }]}
                      accessibilityLiveRegion="polite"
                    >
                      {allPacked ? `All ${items.length} packed — you're ready!` : `${checkedCount} of ${items.length} packed`}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityLabel="Hide packed items"
                    accessibilityState={{ checked: hidePacked }}
                    onPress={() => {
                      haptics.select();
                      setHidePacked((v) => !v);
                    }}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.toggle,
                      {
                        borderColor: hidePacked ? t.colors.primary : t.colors.border,
                        backgroundColor: hidePacked ? t.colors.gradientSubtle : 'transparent',
                        borderRadius: t.radius.pill,
                        opacity: pressed ? 0.7 : 1,
                      },
                      Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
                    ]}
                  >
                    {hidePacked ? <Icon name="check" size={14} color={t.colors.primaryInk} /> : null}
                    <Text style={[t.typography.small, { color: hidePacked ? t.colors.primaryInk : t.colors.textMuted, fontWeight: '600' }]}>
                      {hidePacked ? 'Hiding packed' : 'Hide packed'}
                    </Text>
                  </Pressable>
                </View>
                <View
                  style={[styles.progressTrack, { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.pill }]}
                  accessibilityRole="progressbar"
                  accessibilityLabel="Packing progress"
                  accessibilityValue={{ min: 0, max: 100, now: progressPct }}
                >
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: allPacked ? t.colors.success : t.colors.primary,
                        borderRadius: t.radius.pill,
                        width: `${progressPct}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            ) : null}
          </View>

          {itemsError ? (
            <Text style={[t.typography.body, { color: t.colors.danger }]}>
              Couldn't load your packing list. Please try again.
            </Text>
          ) : null}

          {/* ── Suggest (editors only) ───────────────────────────────────── */}
          {canEditTrip ? (
            <View style={{ gap: t.spacing.xs }}>
              {items.length === 0 ? (
                <Button
                  label="✨ Suggest items"
                  variant="secondary"
                  onPress={() => void handleSuggest()}
                  loading={createItems.isPending}
                  disabled={createItems.isPending}
                  accessibilityLabel="Suggest packing items based on your trip dates and the weather"
                />
              ) : (
                <PackingSuggestionChips
                  chips={pending.slice(0, MAX_SUGGESTION_CHIPS)}
                  totalPending={pending.length}
                  onAddOne={(s) => void handleAddSuggestion(s)}
                  onAddAll={() => void handleSuggest()}
                  disabled={createItems.isPending}
                />
              )}
              {suggestNote ? (
                <Text
                  style={[t.typography.caption, { color: t.colors.textMuted }]}
                  accessibilityLiveRegion="polite"
                >
                  {suggestNote}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* ── Empty state / grouped checklist ──────────────────────────── */}
          {items.length === 0 ? (
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: t.colors.bgElevated,
                  borderColor: t.colors.border,
                  borderRadius: t.radius.md,
                  padding: t.spacing.lg,
                  gap: t.spacing.xs,
                },
              ]}
            >
              <Icon name="luggage" size={40} color={t.colors.primary} />
              <Text style={[t.typography.bodyStrong, { color: t.colors.text, textAlign: 'center' }]}>
                Nothing on the list yet
              </Text>
              <Text
                style={[t.typography.caption, { color: t.colors.textMuted, textAlign: 'center', lineHeight: 18 }]}
              >
                {canEditTrip
                  ? 'Start from smart suggestions based on your trip dates and the weather, or add your own items below.'
                  : 'The trip owner hasn’t added any packing items yet.'}
              </Text>
            </View>
          ) : (
            <>
              {groupViews.length === 0 ? (
                <Text style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center' }]}>
                  Everything is packed. Turn off “Hide packed” to see the full list.
                </Text>
              ) : null}
              {groupViews.map((group) => (
                <PackingCategorySection
                  key={group.key}
                  group={group}
                  collapsed={collapsed.has(group.key)}
                  onToggleCollapsed={() => toggleCollapsed(group.key)}
                  canEdit={canEditTrip}
                  onToggleItem={(item, checked) => {
                    if (id) updateItem.mutate({ itemId: item.id, tripId: id, patch: { checked } });
                  }}
                  onDeleteItem={(item) => void handleDelete(item)}
                />
              ))}
            </>
          )}

          {/* ── Manual add (editors only) ────────────────────────────────── */}
          {canEditTrip ? (
            <AddPackingItemRow onAdd={handleAdd} pending={createItems.isPending} />
          ) : null}
        </ScrollView>
      </KeyboardAvoid>
    </Screen>
  );
}

const styles = StyleSheet.create({
  progressTrack: { height: 8, overflow: 'hidden' },
  progressFill: { height: 8 },
  progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  toggle: {
    borderWidth: 1.5,
    paddingHorizontal: 12,
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    justifyContent: 'center',
  },
  emptyCard: { borderWidth: 1, alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
});
