/**
 * Trips list screen → HOME surface (v2 Phase N1 step 1.3).
 *
 * v2 additions on top of the Phase 20 list:
 *   - HomeHero band (active tab only): destination imagery, trip-countdown
 *     chip (nearest future trip), and the primary "✨ Plan my trip with AI"
 *     CTA → /trip/plan (placeholder now; Wave 3 / N3.5 fills it).
 *   - Empty state gains a "Try a sample trip" secondary action (step 1.5)
 *     that seeds a real 2-day Lisbon trip via useSampleTrip.
 *
 * Original list behavior below is unchanged:
 *
 * Filter / sort pipeline (applied in order, all client-side):
 *   1. archive filter  — driven by `useTrips({ archived })`, server-side
 *   2. search filter   — case-insensitive substring on trip.title
 *   3. date filter     — All | Upcoming | Past
 *   4. sort            — one of: Recent | A→Z | Start date | Duration (desc)
 *
 * Desktop layout (≥ 1024px):
 *   - Header (search, sort, filter, tabs) is constrained to maxWidth 1200px, centred.
 *   - Trip cards render in a 2-column grid at 1024px+, 3-column at 1440px+.
 *   - The grid is centred within a maxWidth 1200px container.
 *   - FlatList is replaced with a flat ScrollView + manual column layout on web
 *     desktop so the "New trip" footer button stays at the bottom of the grid,
 *     not after the last card in a single column.
 *
 * Mobile / tablet layout: unchanged from before.
 *
 * v2 M4 X1.1: this is the Trips tab of app/(app)/(tabs). Insights / Settings
 * pills are gone (they are tabs now); the hero moved into the scroll content
 * so it scrolls away, while search / sort / Active-Archived stay pinned.
 *
 * Duration sort (total leg duration_seconds, descending) defers the legs
 * fetch until the user selects it; if `sortKey` is not `'duration'`,
 * `useAllTripLegs` receives an empty array which keeps the hook disabled
 * (no network request).
 *
 * Date filter runs AFTER search and BEFORE sort so that searches like
 * "Paris" already filter by date category before sorting. Today's date is
 * computed once per render pass as a `YYYY-MM-DD` string; dates in the DB
 * are also stored as `YYYY-MM-DD` text, so string comparison is valid.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Button,
  EmptyState,
  FilterSheet,
  Heading,
  Icon,
  Screen,
  SegmentedControl,
  Skeleton,
  SkeletonGroup,
  SyncStatusPill,
  TAB_SCREEN_EDGES,
  themedRefresh,
} from '@/components';
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
import { HomeHero } from '@/components/home/HomeHero';
import { BREAKPOINTS, useBreakpoint } from '@/hooks/useBreakpoint';
import { useEdgeRuntimeHealth } from '@/hooks/useEdgeRuntimeHealth';
import { useSampleTrip } from '@/hooks/useSampleTrip';
import { confirmDestructive } from '@/lib/confirm';
import { useDebouncedCallback } from '@/lib/hooks/useDebouncedCallback';
import { applySearch, applyDateFilter, applySort } from '@/lib/tripsFilters';
import type { SortKey, DateFilter } from '@/lib/tripsFilters';

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = 'active' | 'archived';

// ─── Constants ───────────────────────────────────────────────────────────────

const TAB_OPTIONS: Array<{ value: Tab; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

const SORT_CYCLE: SortKey[] = ['recent', 'az', 'start_date', 'duration'];

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Recent',
  az: 'A→Z',
  start_date: 'Start',
  // "Duration ↓" communicates the descending direction on the button face.
  duration: 'Duration ↓',
};

const DATE_FILTER_OPTIONS: Array<{ value: DateFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
];

// Max content width for the centred desktop layout.
const DESKTOP_MAX_WIDTH = 1200;

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function TripsList() {
  const t = useTheme();
  const router = useRouter();
  const bp = useBreakpoint();
  const { width: windowWidth } = useWindowDimensions();
  const isDesktop = bp === 'desktop';
  // At 1440px+ switch to 3 columns; between 1024–1439 use 2 columns.
  const columns = windowWidth >= BREAKPOINTS.desktopWide ? 3 : 2;

  // Phase 25 Step 25.12: dev-only Edge Functions health banner.
  const { status: edgeStatus, dismiss: dismissEdgeBanner } = useEdgeRuntimeHealth();

  // ── Tab state (Active / Archived) ──────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('active');

  // ── Search state ───────────────────────────────────────────────────────────
  // `searchText` updates immediately (controlled input); `debouncedSearch`
  // updates after 200 ms of quiet and drives the filter.
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
    searchRef.current?.focus();
  };

  // ── Sort state ─────────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<SortKey>('recent');

  const handleSortCycle = () => {
    const currentIndex = SORT_CYCLE.indexOf(sortKey);
    const nextIndex = (currentIndex + 1) % SORT_CYCLE.length;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    setSortKey(SORT_CYCLE[nextIndex]!);
  };

  // ── Date filter state ──────────────────────────────────────────────────────
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  // ── Server state ───────────────────────────────────────────────────────────
  const { data: trips, isLoading, error, refetch, isRefetching, isPlaceholderData } = useTrips({
    archived: tab === 'archived',
  });
  // keepPreviousData: right after an Active/Archived switch the list still
  // shows the OTHER tab's rows until the new query lands. Dim them and make
  // them non-interactive so nobody archives/deletes/opens a stale row.
  const stale = isPlaceholderData;
  const gate = (node: ReactNode) => (
    <View
      pointerEvents={stale ? 'none' : 'auto'}
      style={stale ? desktopStyles.stale : undefined}
      accessibilityState={{ disabled: stale, busy: stale }}
    >
      {node}
    </View>
  );

  // The unified useTrips() already includes owned + accepted-collaborator rows,
  // each tagged with { isOwner, collaboratorRole }. Partition client-side to
  // preserve the two-section visual UX. Owners-first sort is done server-side.
  const ownedTrips = useMemo(() => (trips ?? []).filter((t) => t.isOwner !== false), [trips]);
  const collaboratedTrips = useMemo(() => (trips ?? []).filter((t) => t.isOwner === false), [trips]);

  const activeTripsIds = useMemo(
    () => (sortKey === 'duration' ? ownedTrips.map((trip) => trip.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownedTrips, sortKey],
  );

  const { byTripId: legsByTripId } = useAllTripLegs(activeTripsIds);

  // ── Derived / filtered + sorted list ──────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);

  const displayedTrips = useMemo(() => {
    const searched = applySearch(ownedTrips, debouncedSearch);
    const dateFilt = applyDateFilter(searched, dateFilter, today);
    return applySort(dateFilt, sortKey, legsByTripId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedTrips, debouncedSearch, dateFilter, sortKey, legsByTripId]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const archiveMutation = useArchiveTrip();
  const unarchiveMutation = useUnarchiveTrip();
  const duplicateMutation = useDuplicateTrip();
  const deleteMutation = useDeleteTrip();

  // ── v2 N1 1.5: onboarding sample trip ──────────────────────────────────────
  const sampleTrip = useSampleTrip();
  const handleSampleTrip = async () => {
    try {
      const newTripId = await sampleTrip.create();
      router.push(`/trip/${newTripId}`);
    } catch {
      // sampleTrip.error renders inline below the empty-state buttons.
    }
  };

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

  // Phase 25 Step 25.12: navigate to the newly duplicated trip.
  const handleDuplicate = async (id: string) => {
    try {
      const newTripId = await duplicateMutation.mutateAsync(id);
      router.push(`/trip/${newTripId}`);
    } catch {
      // Mutation already sets its error state; no additional handling needed.
    }
  };

  // ── List-area state ────────────────────────────────────────────────────────
  // Loading / error no longer early-return: the header (incl. the Active /
  // Archived switcher) must stay on screen so a failing tab can be left.
  // Owned-empty is NOT "nothing to show": a collaborator-only user still
  // gets the empty CTA *plus* the "Shared with me" section.
  const ownedIsEmpty = ownedTrips.length === 0;
  const noResults = !ownedIsEmpty && displayedTrips.length === 0;
  const showShared = tab === 'active' && collaboratedTrips.length > 0;
  const filterActive = dateFilter !== 'all';

  // ── v2 N1 1.5: secondary empty-state action — sample trip ─────────────────
  // Passed via EmptyState's `action` slot so it renders under the primary CTA
  // on both the desktop and mobile empty states.
  const sampleTripAction = (
    <View style={{ gap: t.spacing.sm, alignItems: 'center' }}>
      <Button
        variant="secondary"
        label="Try a sample trip"
        leftIcon={<Icon name="luggage" size={18} />}
        fullWidth={false}
        loading={sampleTrip.isCreating}
        onPress={handleSampleTrip}
        accessibilityLabel="Try a sample trip. Creates a two-day Lisbon example you can edit or delete."
      />
      {sampleTrip.error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[t.typography.small, { color: t.colors.danger, textAlign: 'center' }]}
        >
          {"Couldn't create the sample trip — please try again."}
        </Text>
      ) : null}
    </View>
  );

  // ── Styles (theme-dependent, recreated inline) ──────────────────────────────
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
      borderRadius: t.radius.pill,
      paddingHorizontal: t.spacing.lg,
      height: 46,
      ...t.shadows.sm(t.colors.shadowColor),
    },
    searchIcon: {
      marginRight: t.spacing.sm,
    },
    searchInput: {
      flex: 1,
      ...(t.typography.body as object),
      color: t.colors.text,
      padding: 0,
    },
    clearBtn: {
      padding: t.spacing.xs,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sortBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.colors.bgElevated,
      borderWidth: 1,
      borderColor: t.colors.border,
      borderRadius: t.radius.pill,
      paddingHorizontal: t.spacing.md,
      height: 46,
      minWidth: 46,
      ...t.shadows.sm(t.colors.shadowColor),
    },
    sortBtnText: {
      ...(t.typography.caption as object),
      color: t.colors.text,
      fontSize: 11,
      fontWeight: '600',
      textAlign: 'center',
    },
    filterBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderRadius: t.radius.pill,
      paddingHorizontal: t.spacing.md,
      height: 46,
      minWidth: 46,
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

  // ── Shared header (search + sort + filter + tabs) ─────────────────────────
  const headerContent = (
    <View style={[s.header, isDesktop && desktopStyles.centeredContainer]}>
      {/* ─── Dev-only Edge Functions health banner (Phase 25 Step 25.12) ── */}
      {edgeStatus === 'unreachable' ? (
        <EdgeRuntimeBanner onDismiss={dismissEdgeBanner} />
      ) : null}

      {/* ─── Header row: title + sync pill. Insights / Settings moved to the
          app tab bar (M4 X1.1); the hero scrolls with the list below. ─── */}
      <View style={s.titleRow}>
        <Heading level={1}>Your trips</Heading>
        {/* v2 S2.7: sync-status pill — renders null while the Tier-1 sync
            flag is off (zero layout shift). */}
        <SyncStatusPill />
      </View>

      {/* ─── Search + Sort + Filter row ──────────────────────────────── */}
      <View style={s.searchRow}>
        <View style={s.searchWrap}>
          <View style={s.searchIcon}>
            <Icon name="search" size={18} color={t.colors.textMuted} />
          </View>
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
              hitSlop={10}
            >
              <Icon name="x" size={18} color={t.colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <Pressable
          onPress={handleSortCycle}
          accessibilityRole="button"
          accessibilityLabel={`Sort: ${SORT_LABELS[sortKey]}. Tap to change sort order.`}
          style={({ pressed }) => [s.sortBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={s.sortBtnText}>{SORT_LABELS[sortKey]}</Text>
        </Pressable>

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
          setSearchText('');
          pushDebouncedSearch.cancel();
          setDebouncedSearch('');
          setSortKey('recent');
          setDateFilter('all');
        }}
      />
    </View>
  );

  // ── Reusable list-area fragments ──────────────────────────────────────────
  const refreshControl = <RefreshControl refreshing={isRefetching} onRefresh={refetch} {...themedRefresh(t)} />;
  const gridGutter = t.spacing.md;

  // Desktop grid: no flex `gap` (percentage widths + gap overflow and wrap to
  // one card per row). Instead each cell is exactly 100/columns % wide and
  // carries half the gutter as padding; the row's negative margin cancels the
  // outer half-gutters so cards stay flush with the header edges.
  type ListTrip = (typeof displayedTrips)[number];
  const renderGrid = (items: ListTrip[], renderCard: (item: ListTrip) => ReactNode) => (
    <View style={[desktopStyles.gridRow, { marginHorizontal: -gridGutter / 2 }]}>
      {items.map((item) => (
        <View
          key={item.id}
          style={[
            desktopStyles.gridItem,
            {
              width: `${(100 / columns).toFixed(4)}%` as unknown as number,
              paddingHorizontal: gridGutter / 2,
              paddingBottom: gridGutter,
            },
          ]}
        >
          {renderCard(item)}
        </View>
      ))}
    </View>
  );

  const renderSharedCard = (item: (typeof collaboratedTrips)[number]) => (
    <View style={{ position: 'relative' }}>
      {gate(<TripCard trip={item} onPress={() => router.push(`/trip/${item.id}`)} />)}
      <SharedBadge role={item.collaboratorRole} />
    </View>
  );

  // "Shared with me" — rendered both under owned trips and under the empty
  // state (collaborator-only users), on desktop (grid) and mobile (stack).
  const sharedSection = showShared ? (
    <View style={{ marginTop: t.spacing.xl, width: '100%', gap: t.spacing.md }}>
      <Text
        style={[t.typography.subtitle, { color: t.colors.text }]}
        accessibilityRole="header"
        aria-level={2}
      >
        Shared with me
      </Text>
      {isDesktop ? (
        renderGrid(collaboratedTrips, renderSharedCard)
      ) : (
        <View style={{ gap: t.spacing.lg }}>
          {collaboratedTrips.map((item) => (
            <View key={item.id}>{renderSharedCard(item)}</View>
          ))}
        </View>
      )}
    </View>
  ) : null;

  // v2 N1 1.3 hero (imagery + AI CTA + countdown), active tab only. M4 X1.1:
  // lives INSIDE the scroll content so it scrolls away with the list, while
  // the search / sort / Active-Archived header above stays pinned.
  const hero =
    tab === 'active' ? (
      <View style={{ paddingBottom: t.spacing.lg }}>
        <HomeHero
          trips={trips ?? []}
          onPlanWithAI={() => router.push('/trip/plan')}
          onOpenTrip={(id) => router.push(`/trip/${id}`)}
        />
      </View>
    ) : null;

  const emptyState =
    tab === 'active' ? (
      <EmptyState
        {...noTrips}
        onPress={() => router.push('/trip/new')}
        action={sampleTripAction}
      />
    ) : (
      <EmptyState title="No archived trips" body="Archived trips will appear here." />
    );

  // Scrollable wrapper for every non-list state so tall empty states (CTA +
  // "Try a sample trip" at 375×667) and the shared section stay reachable.
  const scrollContainerStyle = [
    isDesktop && desktopStyles.centeredContainer,
    { paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.lg, paddingBottom: t.spacing.xl },
  ];

  let listArea: ReactNode;
  if (isLoading) {
    listArea = (
      <ScrollView contentContainerStyle={scrollContainerStyle}>
        {hero}
        <SkeletonGroup label="Loading trips" style={{ gap: t.spacing.lg }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={isDesktop ? 180 : 132} radius="xl" />
          ))}
        </SkeletonGroup>
      </ScrollView>
    );
  } else if (error) {
    listArea = (
      <ScrollView contentContainerStyle={scrollContainerStyle} refreshControl={refreshControl}>
        {hero}
        <EmptyState
          title="Couldn't load trips"
          description={(error as Error).message}
          action={<Button label="Retry" fullWidth={false} onPress={() => refetch()} />}
        />
      </ScrollView>
    );
  } else if (ownedIsEmpty || noResults) {
    listArea = (
      <ScrollView contentContainerStyle={scrollContainerStyle} refreshControl={refreshControl}>
        {hero}
        {ownedIsEmpty ? (
          emptyState
        ) : (
          <View style={s.noResultsWrap}>
            <Text accessibilityLiveRegion="polite" style={s.noResultsText}>
              No trips match your search.
            </Text>
          </View>
        )}
        {sharedSection}
      </ScrollView>
    );
  } else if (isDesktop) {
    listArea = (
      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={scrollContainerStyle}
      >
        {hero}
        {renderGrid(displayedTrips, (item) => (
          gate(
            <TripCard
              trip={item}
              onPress={() => router.push(`/trip/${item.id}`)}
              onArchive={(id) => archiveMutation.mutate(id)}
              onUnarchive={(id) => unarchiveMutation.mutate(id)}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
            />,
          )
        ))}

        {tab === 'active' ? (
          <View style={{ marginTop: t.spacing.sm, width: '100%' }}>
            <Button label="New trip" onPress={() => router.push('/trip/new')} />
          </View>
        ) : null}

        {sharedSection}
      </ScrollView>
    );
  } else {
    listArea = (
      <FlatList
        data={displayedTrips}
        keyExtractor={(trip) => trip.id}
        renderItem={({ item }) => (
          gate(
            <TripCard
              trip={item}
              onPress={() => router.push(`/trip/${item.id}`)}
              onArchive={(id) => archiveMutation.mutate(id)}
              onUnarchive={(id) => unarchiveMutation.mutate(id)}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
            />,
          )
        )}
        contentContainerStyle={{
          padding: t.spacing.lg,
          gap: t.spacing.lg,
        }}
        refreshControl={refreshControl}
        ListHeaderComponent={hero}
        ListFooterComponent={
          tab === 'active' ? (
            <View style={{ marginTop: t.spacing.lg }}>
              <Button label="New trip" onPress={() => router.push('/trip/new')} />
              {sharedSection}
            </View>
          ) : null
        }
      />
    );
  }

  return (
    <Screen padded={false} edges={TAB_SCREEN_EDGES}>
      {headerContent}

      {listArea}

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

// ── EdgeRuntimeBanner ─────────────────────────────────────────────────────────
// Dev-only banner shown when the local Supabase Edge Functions runtime is not
// reachable. Never shown in production (useEdgeRuntimeHealth short-circuits).
function EdgeRuntimeBanner({ onDismiss }: { onDismiss: () => void }) {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel="Local Edge Functions not reachable warning"
      style={[
        edgeBannerStyles.banner,
        {
          backgroundColor: t.colors.dangerLight,
          borderColor: t.colors.danger,
          borderRadius: t.radius.md,
        },
      ]}
    >
      <Icon name="alert-triangle" size={16} color={t.colors.danger} />
      <Text
        style={[t.typography.caption, { color: t.colors.danger, flex: 1 }]}
        accessibilityLiveRegion="polite"
      >
        {'Local Edge Functions not reachable. Run `npx supabase functions serve` in another terminal.'}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss Edge Functions warning"
        onPress={onDismiss}
        hitSlop={12}
        style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
      >
        <Text style={[t.typography.caption, { color: t.colors.danger, fontWeight: '600' }]}>
          Dismiss
        </Text>
      </Pressable>
    </View>
  );
}

const edgeBannerStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});

// ── SharedBadge ──────────────────────────────────────────────────────────────
// Overlaid on the top-right of a collaborator trip card.
// Uses position absolute on web (which works in RN Web) to avoid changing TripCard.
// `role` comes from trip.collaboratorRole (now available from the unified useTrips()).
function SharedBadge({ role }: { role?: 'viewer' | 'editor' | null }) {
  const t = useTheme();
  const label = role ? `Shared · ${role}` : 'Shared with me';
  return (
    <View
      style={[
        sharedBadgeStyles.badge,
        {
          backgroundColor: t.colors.bgMuted,
          borderColor: t.colors.border,
          borderRadius: t.radius.pill,
        },
      ]}
      accessible
      accessibilityLabel={label}
    >
      <Text style={[t.typography.small, { color: t.colors.textMuted, fontWeight: '600' }]}>
        {label}
      </Text>
    </View>
  );
}

const sharedBadgeStyles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    zIndex: 1,
  },
});

// ── Desktop-specific static styles ───────────────────────────────────────────
// These don't depend on the theme so they can be static.
const desktopStyles = StyleSheet.create({
  // Placeholder rows from the other tab while the new list loads.
  stale: { opacity: 0.5 },
  // Centers a content block and constrains its max width.
  centeredContainer: {
    maxWidth: DESKTOP_MAX_WIDTH,
    width: '100%',
    alignSelf: 'center',
    // Horizontal padding is applied at usage site to support variation.
  },
  // Flex-wrap row for the desktop card grid. No explicit width: it stretches
  // to the parent, and the negative horizontal margin applied at the usage
  // site widens it by one gutter so percentage cell widths sum to exactly 100%.
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignSelf: 'stretch',
  },
  // Each grid item stretches to fill its column slot.
  gridItem: {
    // flex: 0 lets width drive the size; no stretching or shrinking.
    flexGrow: 0,
    flexShrink: 0,
  },
});
