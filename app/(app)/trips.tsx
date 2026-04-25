/**
 * Trips list screen.
 *
 * Filter / sort pipeline (applied in order, all client-side):
 *   1. archive filter  — driven by `useTrips({ archived })`, server-side
 *   2. search filter   — case-insensitive substring on trip.title
 *   3. sort            — one of: Recent | A→Z | Start date
 *
 * Omitted (follow-up): "Cost" sort. Computing the total cost per trip would
 * require calling `useTripLegs` once per trip, causing an N+1 request burst
 * on every render. Defer until a dedicated cost-rollup column is added to the
 * `trips` table server-side (or a materialized view is ready).
 *
 * Omitted (follow-up): Date filter (Upcoming / Past). Three stacked controls
 * (search, sort, Active/Archived) already fill the header on a 360 px screen;
 * adding a fourth felt cramped in testing. Revisit when the header gets a
 * dedicated filter drawer / sheet affordance.
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
import { Button, EmptyState, Heading, Screen, SegmentedControl } from '@/components';
import { noTrips } from '@/components/emptyStates';
import { TripCard } from '@/components/TripCard';
import {
  useTrips,
  useArchiveTrip,
  useUnarchiveTrip,
  useDuplicateTrip,
  useDeleteTrip,
} from '@/api';
import { useTheme } from '@/theme';
import { confirmDestructive } from '@/lib/confirm';
import { useDebouncedCallback } from '@/lib/hooks/useDebouncedCallback';
import type { Trip } from '@/api/types';

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = 'active' | 'archived';

/**
 * Sort keys available in the UI.
 *
 * "cost" is intentionally excluded — see the file-level comment.
 */
type SortKey = 'recent' | 'az' | 'start_date';

// ─── Constants ───────────────────────────────────────────────────────────────

const TAB_OPTIONS: Array<{ value: Tab; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

const SORT_CYCLE: SortKey[] = ['recent', 'az', 'start_date'];

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Recent',
  az: 'A→Z',
  start_date: 'Start date',
};

// Locale-aware collator for A→Z sort; stable instance so useMemo doesn't
// recreate it on every render.
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function applySearch(trips: Trip[], query: string): Trip[] {
  const q = query.trim().toLowerCase();
  if (!q) return trips;
  return trips.filter((trip) => trip.title.toLowerCase().includes(q));
}

function applySort(trips: Trip[], key: SortKey): Trip[] {
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

  // ── Server state ───────────────────────────────────────────────────────────
  const { data: trips, isLoading, error, refetch, isRefetching } = useTrips({
    archived: tab === 'archived',
  });

  // ── Derived / filtered + sorted list ──────────────────────────────────────
  // Order: archive filter (server) → search → sort.
  const displayedTrips = useMemo(() => {
    const base = trips ?? [];
    const searched = applySearch(base, debouncedSearch);
    return applySort(searched, sortKey);
  }, [trips, debouncedSearch, sortKey]);

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

  // `isEmpty` is true when the server returned no trips at all (no data to
  // filter). Distinguish from `noResults`, which means filters produced zero
  // matches from a non-empty list.
  const serverIsEmpty = !trips || trips.length === 0;
  const noResults = !serverIsEmpty && displayedTrips.length === 0;

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
    // Search row: input + sort button side-by-side.
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
    // Sort cycle button: pill-shaped, sits beside the search input.
    sortBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.colors.bgElevated,
      borderWidth: 1,
      borderColor: t.colors.border,
      borderRadius: t.radius.md,
      paddingHorizontal: t.spacing.md,
      height: 40,
      gap: t.spacing.xs,
    },
    sortLabel: {
      ...(t.typography.caption as object),
      color: t.colors.textMuted,
    },
    sortValue: {
      ...(t.typography.bodyStrong as object),
      color: t.colors.text,
      fontSize: 14,
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

        {/* ─── Search + Sort row ───────────────────────────────────────── */}
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

          {/* Sort cycle button — taps to advance: Recent → A→Z → Start date → Recent */}
          <Pressable
            onPress={handleSortCycle}
            accessibilityRole="button"
            accessibilityLabel={`Sort: ${SORT_LABELS[sortKey]}. Tap to change sort order.`}
            style={({ pressed }) => [s.sortBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={s.sortLabel}>Sort</Text>
            <Text style={s.sortValue}>{SORT_LABELS[sortKey]}</Text>
          </Pressable>
        </View>

        {/* ─── Active / Archived segmented control ─────────────────────── */}
        <SegmentedControl
          value={tab}
          options={TAB_OPTIONS}
          onChange={(nextTab) => {
            setTab(nextTab);
            // Reset search + sort when switching tabs so the user starts fresh
            // and doesn't see confusing zero-result states.
            setSearchText('');
            pushDebouncedSearch.cancel();
            setDebouncedSearch('');
            setSortKey('recent');
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
    </Screen>
  );
}
