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
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeBack } from '@/hooks/useSafeBack';
import { BackButton, Button, Screen } from '@/components';
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
import { seedPackingList } from '@/lib/packingSeed';
import { confirmDestructive } from '@/lib/confirm';
import {
  buildTripWeatherParams,
  monthOfDateString,
} from '@/components/trip-detail/tripWeather';
import { groupPackingItems } from '@/components/packing/groupPackingItems';
import { PackingItemRow } from '@/components/packing/PackingItemRow';
import { AddPackingItemRow } from '@/components/packing/AddPackingItemRow';

const PACKING_MAX_WIDTH = 720;

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
  const checkedCount = useMemo(() => items.filter((i) => i.checked).length, [items]);

  // ── Actions ───────────────────────────────────────────────────────────────
  async function handleSuggest() {
    if (!id) return;
    setSuggestNote(null);
    const startMonth =
      (trip?.start_date ? monthOfDateString(trip.start_date) : null) ??
      new Date().getMonth() + 1;
    const seeded = seedPackingList({ startMonth, days: tripDayCount, hasRainyDay });
    const existing = new Set(items.map((i) => i.label.trim().toLowerCase()));
    const fresh = seeded.filter((s) => !existing.has(s.label.trim().toLowerCase()));
    if (fresh.length === 0) {
      setSuggestNote('Your list already covers everything we would suggest.');
      return;
    }
    try {
      await createItems.mutateAsync({
        tripId: id,
        items: fresh.map((s) => ({ label: s.label, category: s.category, auto: true })),
      });
      setSuggestNote(`Added ${fresh.length} suggested item${fresh.length === 1 ? '' : 's'}.`);
    } catch {
      setSuggestNote("Couldn't add suggestions — try again.");
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
        <ActivityIndicator size="large" color={t.colors.primary} />
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

  return (
    <Screen padded={false}>
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
          <Text
            style={[t.typography.title, { color: t.colors.text }]}
            accessibilityRole="header"
            aria-level={1}
          >
            🧳 Packing list
          </Text>
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{trip.title}</Text>
          {items.length > 0 ? (
            <View style={{ gap: t.spacing.xs, paddingTop: t.spacing.xs }}>
              <Text
                style={[t.typography.caption, { color: t.colors.text, fontWeight: '600' }]}
                accessibilityLiveRegion="polite"
              >
                {checkedCount} of {items.length} packed
              </Text>
              {/* Decorative progress bar — the live text above carries the value. */}
              <View
                style={[styles.progressTrack, { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.pill }]}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: t.colors.primary,
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
            <Button
              label="✨ Suggest items"
              variant="secondary"
              onPress={() => void handleSuggest()}
              loading={createItems.isPending}
              disabled={createItems.isPending}
              accessibilityLabel="Suggest packing items based on your trip dates and the weather"
            />
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
            <Text style={styles.emptyEmoji} accessibilityElementsHidden importantForAccessibility="no">
              🧳
            </Text>
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
          groups.map((group) => (
            <View key={group.key} style={{ gap: t.spacing.sm }}>
              <Text
                style={[t.typography.subtitle, { color: t.colors.text }]}
                accessibilityRole="header"
                aria-level={3}
              >
                {group.title}
              </Text>
              {group.items.map((item) => (
                <PackingItemRow
                  key={item.id}
                  item={item}
                  canEdit={canEditTrip}
                  onToggle={(checked) => {
                    if (id) updateItem.mutate({ itemId: item.id, tripId: id, patch: { checked } });
                  }}
                  onDelete={() => void handleDelete(item)}
                />
              ))}
            </View>
          ))
        )}

        {/* ── Manual add (editors only) ────────────────────────────────── */}
        {canEditTrip ? (
          <AddPackingItemRow onAdd={handleAdd} pending={createItems.isPending} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  progressTrack: { height: 6, overflow: 'hidden' },
  progressFill: { height: 6 },
  emptyCard: { borderWidth: 1, alignItems: 'center' },
  emptyEmoji: { fontSize: 40, lineHeight: 48 },
});
