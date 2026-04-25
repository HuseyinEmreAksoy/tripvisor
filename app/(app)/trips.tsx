/**
 * Trips list screen.
 *
 * Filter / sort pipeline (applied in order, all client-side):
 *   1. archive filter  — driven by `useTrips({ archived })`, server-side
 *   2. search filter   — case-insensitive substring on trip.title
 *   3. date filter     — All | Upcoming | Past
 *   4. sort            — one of: Recent | A→Z | Start date | Cost (desc)
 *
 * Cost sort defers the legs fetch until the user selects it; if `sortKey`
 * is not `'cost'`, `useAllTripLegs` receives an empty array which keeps
 * the hook disabled (no network request).
 *
 * Date filter runs AFTER search and BEFORE sort so that searches like
 * "Paris" already filter by date category before sorting. Today's date is
 * computed once per render pass as a `YYYY-MM-DD` string; dates in the DB
 * are also stored as `YYYY-MM-DD` text, so string comparison is valid.
 */

import { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Button, EmptyState, FilterSheet, Heading, Screen, SegmentedControl } from '@/components';
import { noTrips } from '@/components/emptyStates';
import { TripCard } from '@/components/TripCard';
import {
  useTrips,
  useArchiveTrip,
  useUnarchiveTrip,
  useDuplicateTrip,
  useDeleteTrip,
  useAllTripLegs,
} from '@/api';
import { useTheme } from '@/theme';
import { confirmDestructive } from '@/lib/confirm';
import { useDebouncedCallback } from '@/lib/hooks/useDebouncedCallback';
import type { Trip } from '@/api/types';

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = 'active' | 'archived';

type SortKey = 'recent' | 'az' | 'start_date' | 'cost';

/** Date-based filter applied after search and before sort. */
type DateFilter = 'all' | 'upcoming' | 'past';

// ─── Constants ───────────────────────────────────────────────────────────────

const TAB_OPTIONS: Array<{ value: Tab; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

const SORT_CYCLE: SortKey[] = ['recent', 'az', 'start_date', 'cost'];

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Recent',
  az: 'A→Z',
  start_date: 'Start',
  // "Cost ↓" communicates the descending direction on the button face.
  cost: 'Cost ↓',
};

const DATE_FILTER_OPTIONS: Array<{ value: DateFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
];

// Locale-aware collator for A→Z sort; stable instance so useMemo doesn't
// recreate it on every render.
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function applySearch(trips: Trip[], query: string): Trip[] {
  const q = query.trim().toLowerCase();
  if (!q) return trips;
  return trips.filter((trip) => trip.title.toLowerCase().includes(q));
}

/**
 * Applies the Upcoming / Past / All date filter.
 *
 * Rules:
 *   upcoming  — start_date >= today, OR (start_date null AND end_date >= today),
 *               OR both dates null (unscheduled active trip — kept visible).
 *   past      — end_date < today AND end_date != null.
 *   all       — no filtering.
 *
 * Both sides of every comparison are `YYYY-MM-DD` strings so lexicographic
 * `<` / `>=` is correct.
 */
function applyDateFilter(trips: Trip[], filter: DateFilter, today: string): Trip[] {
  if (filter === 'all') return trips;

  return trips.filter((trip) => {
    const { start_date, end_date } = trip;

    if (filter === 'upcoming') {
      // Unscheduled trip — always show in Upcoming.
      if (!start_date && !end_date) return true;
      if (start_date) return start_date >= today;
      // start_date is null but end_date is present.
      return end_date != null && end_date >= today;
    }

    // filter === 'past'
    return end_date != null && end_date < today;
  });
}

function applySort(
  trips: Trip[],
  key: SortKey,
  legsByTripId: Map<string, { distance_meters: number }[]>,
): Trip[] {
  // Slice to avoid mutating the TanStack Query cache array.
  const sorted = trips.slice();
  switch (key) {
    case 'recent':
      sorted.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      break;
    case 'az':
      sorted.sort((a, b) => collator.compare(a.title, b.title));
      break;
    case 'start_date':
      sorted.sort((a, b) => {
        // Null start_dates sink to the bottom.
        if (!a.start_date && !b.start_date) return 0;
        if (!a.start_date) return 1;
        if (!b.start_date) return -1;
        return a.start_date.localeCompare(b.start_date);
      });
      break;
    case 'cost': {
      /**
       * Compute trip cost = sum(leg.distance_meters / 1000 * trip.cost_per_km).
       * Trips with no legs (total cost = 0) sink to the bottom via the
       * fallback `created_at` tiebreak to keep ordering stable.
       */
      const cost = (trip: Trip): number => {
        const legs = legsByTripId.get(trip.id) ?? [];
        return legs.reduce(
          (acc, leg) => acc + (leg.distance_meters / 1000) * trip.cost_per_km,
          0,
        );
      };
      sorted.sort((a, b) => {
        const diff = cost(b) - cost(a); // descending
        if (diff !== 0) return diff;
        // Tiebreak: more recent first.
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      break;
    }
  }
  return sorted;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function TripsList() {
  const t = useTheme();
  const router = useRouter();

  // ── Tab state (Active / Archived) ──────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('active');

  // ── Search state ───────────────────────────────────────────────────────────
  // `searchText` updates immediately (controlled input); `debouncedSearch`
  // updates after 200 ms of quiet and drives the filter. This gives instant
  // cursor responsiveness while avoiding a filter recalculation on every
  // keystroke.
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchRef = useRef<TextInput>(null);

  const pushDebouncedSearch = useDebouncedCallback((value: string) => {
    setDebouncedSearch(value);
  }, 200);

  const handleSearchChange = (text: string) => {
    setSearchText(text);
    pushDebouncedSearch(text);
  };

  const handleClearSearch = () => {
    setSearchText('');
    pushDebouncedSearch.cancel();
    setDebouncedSearch('');
    // Re-focus after clearing so the user can type a new query without an
    // extra tap.
    searchRef.current?.focus();
  };

  // ── Sort state ─────────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<SortKey>('recent');

  const handleSortCycle = () => {
    const currentIndex = SORT_CYCLE.indexOf(sortKey);
    const nextIndex = (currentIndex + 1) % SORT_CYCLE.length;
    // SORT_CYCLE is a fixed-length tuple so nextIndex is always in bounds;
    // the non-null assertion avoids the TS2345 on `SortKey | undefined`.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    setSortKey(SORT_CYCLE[nextIndex]!);
  };

  // ── Date filter state ──────────────────────────────────────────────────────
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  // ── Server state ───────────────────────────────────────────────────────────
  const { data: trips, isLoading, error, refetch, isRefetching } = useTrips({
    archived: tab === 'archived',
  });

  // Build the trip-id list for the legs batch fetch. Only pass ids when the
  // user has actually selected "cost" sort — otherwise we give an empty array
  // which keeps the hook disabled (no query, no network traffic).
  const activeTripsIds = useMemo(
    () => (sortKey === 'cost' ? (trips ?? []).map((trip) => trip.id) : []),
    // Intentionally include sortKey here so the list re-computes when the
    // user switches away from cost sort (disabling the query).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trips, sortKey],
  );

  const { byTripId: legsByTripId } = useAllTripLegs(activeTripsIds);

  // ── Derived / filtered + sorted list ──────────────────────────────────────
  // Order: archive filter (server) → search → date filter → sort.
  const today = new Date().toISOString().slice(0, 10);

  const displayedTrips = useMemo(() => {
    const base = trips ?? [];
    const searched = applySearch(base, debouncedSearch);
    const dateFilt = applyDateFilter(searched, dateFilter, today);
    return applySort(dateFilt, sortKey, legsByTripId);
    // `today` is a stable string per render day; it does not need to be in
    // deps — the memo will naturally recompute whenever trips/search/filter
    // changes. Including it would cause unnecessary daily busts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips, debouncedSearch, dateFilter, sortKey, legsByTripId]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const archiveMutation = useArchiveTrip();
  const unarchiveMutation = useUnarchiveTrip();
  const duplicateMutation = useDuplicateTrip();
  const deleteMutation = useDeleteTrip();

  const handleDelete = async (id: string) => {
    const confirmed = await confirmDestructive({
      title: 'Delete trip?',
      message: 'This permanently deletes the trip and all its places. This cannot be undone.',
      confirmLabel: 'Delete',
    });
    if (confirmed) {
      deleteMutation.mutate(id);
    }
  };

  // ── Loading / error states ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Screen>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>Loading trips…</Text>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <EmptyState
          title="Couldn't load trips"
          description={(error as Error).message}
          action={<Button label="Retry" onPress={() => refetch()} />}
        />
      </Screen>
    );
  }

  // `serverIsEmpty` is true when the server returned no trips at all (no data
  // to filter). Distinguish from `noResults`, which means filters produced
  // zero matches from a non-empty list.
  const serverIsEmpty = !trips || trips.length === 0;
  const noResults = !serverIsEmpty && displayedTrips.length === 0;

  // Whether any filter is active (used to visually accent the Filter button).
  const filterActive = dateFilter !== 'all';

  // ── Styles ─────────────────────────────────────────────────────────────────
  const s = StyleSheet.create({
    header: {
      paddingHorizontal: t.spacing.lg,
      paddingTop: t.spacing.lg,
      gap: t.spacing.md,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    settingsBtn: {
      paddingHorizontal: t.spacing.md,
      paddingVertical: t.spacing.sm,
    },
    settingsBtnText: {
      ...(t.typography.bodyStrong as object),
      color: t.colors.primary,
    },
    // Search row: input + sort button + filter button side-by-side.
    // On 360px: search input takes flex:1 (shrinks), sort and filter are
    // fixed-width icon/label pills. Total button width budget ≈ 120px so
    // the search input retains ~196px — wide enough to show ~15 chars.
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
    },
    searchWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.colors.bgElevated,
      borderWidth: 1,
      borderColor: t.colors.border,
      borderRadius: t.radius.md,
      paddingHorizontal: t.spacing.md,
      height: 40,
    },
    searchInput: {
      flex: 1,
      ...(t.typography.body as object),
      color: t.colors.text,
      // Suppress the default bottom border on Android.
      padding: 0,
    },
    clearBtn: {
      paddingHorizontal: t.spacing.xs,
      paddingVertical: t.spacing.xs,
    },
    clearBtnText: {
      ...(t.typography.bodyStrong as object),
      color: t.colors.textMuted,
      lineHeight: 20,
    },
    // Sort cycle button — icon-only on 360px to keep the row compact.
    // The sort key is communicated via accessibilityLabel so icon-only
    // is accessible.
    sortBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.colors.bgElevated,
      borderWidth: 1,
      borderColor: t.colors.border,
      borderRadius: t.radius.md,
      paddingHorizontal: t.spacing.sm,
      height: 40,
      minWidth: 40,
    },
    sortBtnText: {
      ...(t.typography.caption as object),
      color: t.colors.text,
      fontSize: 11,
      textAlign: 'center',
    },
    // Filter button — accented with primary colour when a filter is active.
    filterBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderRadius: t.radius.md,
      paddingHorizontal: t.spacing.sm,
      height: 40,
      minWidth: 40,
    },
    noResultsWrap: {
      padding: t.spacing.lg,
      alignItems: 'center',
    },
    noResultsText: {
      ...(t.typography.body as object),
      color: t.colors.textMuted,
      textAlign: 'center',
    },
  });

  return (
    <Screen padded={false}>
      <View style={s.header}>
        {/* ─── Header row: title + settings link ──────────────────────── */}
        <View style={s.titleRow}>
          <Heading level={1}>Your trips</Heading>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            // The router.d.ts stubs are stale and don't yet include the
            // settings route; cast to silence the type error until `npx expo
            // start` regenerates .expo/types/router.d.ts.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onPress={() => router.push('/(app)/settings' as any)}
            hitSlop={8}
            style={({ pressed }) => [s.settingsBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={s.settingsBtnText}>Settings</Text>
          </Pressable>
        </View>

        {/* ─── Search + Sort + Filter row ──────────────────────────────── */}
        {/*
          Layout target: 360px wide.
          - searchWrap: flex:1 → takes all remaining space (~196px at 360px)
          - sortBtn: ~56px (2-line label, e.g. "Start" or "Cost ↓")
          - filterBtn: 40px (icon-only; label on wider screens)
          Total gutters: lg(16) * 2 + sm(8) * 2 = 48px
          Button budget: 56 + 40 = 96px
          Search input: 360 - 48 - 96 = 216px ✓
        */}
        <View style={s.searchRow}>
          {/* Search input */}
          <View style={s.searchWrap}>
            <TextInput
              ref={searchRef}
              value={searchText}
              onChangeText={handleSearchChange}
              placeholder="Search trips by title"
              placeholderTextColor={t.colors.textMuted}
              style={s.searchInput}
              accessibilityLabel="Search trips by title"
              accessibilityRole="search"
              returnKeyType="search"
              clearButtonMode="never"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchText.length > 0 ? (
              <Pressable
                onPress={handleClearSearch}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                style={({ pressed }) => [s.clearBtn, { opacity: pressed ? 0.5 : 1 }]}
                hitSlop={8}
              >
                <Text style={s.clearBtnText}>✕</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Sort cycle button — taps to advance: Recent → A→Z → Start → Cost ↓ → Recent */}
          <Pressable
            onPress={handleSortCycle}
            accessibilityRole="button"
            accessibilityLabel={`Sort: ${SORT_LABELS[sortKey]}. Tap to change sort order.`}
            style={({ pressed }) => [s.sortBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={s.sortBtnText}>{SORT_LABELS[sortKey]}</Text>
          </Pressable>

          {/* Filter button — opens the date-filter sheet */}
          <Pressable
            onPress={() => setFilterSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={
              filterActive
                ? `Filter: ${DATE_FILTER_OPTIONS.find((o) => o.value === dateFilter)?.label ?? dateFilter}. Tap to change.`
                : 'Filter trips. No filter active.'
            }
            style={({ pressed }) => [
              s.filterBtn,
              {
                backgroundColor: filterActive ? t.colors.primary : t.colors.bgElevated,
                borderColor: filterActive ? t.colors.primary : t.colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            {/* ⊟ icon is a compact "filter funnel" proxy; universally available
                as a Unicode char so no extra asset is needed. */}
            <Text
              style={{
                fontSize: 16,
                color: filterActive ? t.colors.primaryText : t.colors.textMuted,
              }}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              ⊟
            </Text>
          </Pressable>
        </View>

        {/* ─── Active / Archived segmented control ─────────────────────── */}
        <SegmentedControl
          value={tab}
          options={TAB_OPTIONS}
          onChange={(nextTab) => {
            setTab(nextTab);
            // Reset search + sort + date filter when switching tabs so the
            // user starts fresh and doesn't see confusing zero-result states.
            setSearchText('');
            pushDebouncedSearch.cancel();
            setDebouncedSearch('');
            setSortKey('recent');
            setDateFilter('all');
          }}
        />
      </View>

      {serverIsEmpty ? (
        tab === 'active' ? (
          // Active tab empty state — preserve existing "Plan your first trip" copy.
          <EmptyState
            {...noTrips}
            onPress={() => router.push('/trip/new')}
          />
        ) : (
          // Archived tab empty state.
          <EmptyState
            title="No archived trips"
            body="Archived trips will appear here."
          />
        )
      ) : noResults ? (
        // Filters yielded zero matches from a non-empty list.
        <View style={s.noResultsWrap}>
          <Text style={s.noResultsText}>No trips match your search.</Text>
        </View>
      ) : (
        <FlatList
          data={displayedTrips}
          keyExtractor={(trip) => trip.id}
          renderItem={({ item }) => (
            <TripCard
              trip={item}
              onPress={() => router.push(`/trip/${item.id}`)}
              onArchive={(id) => archiveMutation.mutate(id)}
              onUnarchive={(id) => unarchiveMutation.mutate(id)}
              onDuplicate={(id) => duplicateMutation.mutate(id)}
              onDelete={handleDelete}
            />
          )}
          contentContainerStyle={{
            padding: t.spacing.lg,
            gap: t.spacing.md,
          }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          ListFooterComponent={
            tab === 'active' ? (
              <View style={{ marginTop: t.spacing.lg }}>
                <Button label="New trip" onPress={() => router.push('/trip/new')} />
              </View>
            ) : null
          }
        />
      )}

      {/* ─── Date filter sheet ───────────────────────────────────────────── */}
      <FilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="Filter trips"
        options={DATE_FILTER_OPTIONS}
        selected={dateFilter}
        onSelect={(value) => setDateFilter(value)}
      />
    </Screen>
  );
}
