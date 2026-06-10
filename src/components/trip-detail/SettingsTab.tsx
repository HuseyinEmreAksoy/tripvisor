/**
 * SettingsTab — the settings tab content for the trip detail route
 * (extracted from app/(app)/trip/[id]/index.tsx in v2 Phase N1 step 1.1 —
 * pure refactor).
 *
 * Sections: cover photo · trip meta (daily plan time + transport mode) ·
 * budget (currency, budget card, category breakdown, expense list) ·
 * accommodation · liked/disliked catalog · collaborators link · share card ·
 * calendar (.ics) export · danger zone (delete trip).
 *
 * Data flow: trip meta + role gates come from the route shell as props.
 * The hooks v1 already had inside this block are kept here: useUpdateTrip,
 * useTripExpenseRollup/useTripExpenses/useDeleteTripExpense (budget),
 * useTripAccommodations/useDeleteTripAccommodation (stays; TanStack dedupes
 * against the shell's subscription), useTripReactions + useTripPlaces +
 * useSession (reaction catalog), useDownloadTripIcs (export), useRouter
 * (collaborators / place links).
 */
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, SegmentedControl, Slider } from '@/components';
import { ShareLinkCard } from '@/components/ShareLinkCard';
import { dayColor } from '@/components/Map';
import { useTheme } from '@/theme';
import { useDebouncedCallback } from '@/lib/hooks/useDebouncedCallback';
// Metro resolves ics.native.ts on native, ics.web.ts on web automatically.
import { useDownloadTripIcs } from '@/api/ics';
import {
  useDeleteTripExpense,
  useTripPlaces,
  useUpdateTrip,
  type TransportMode,
  type TripCurrency,
  type TripPlace,
} from '@/api';
import { useTripExpenseRollup, useTripExpenses } from '@/api/trip-expenses';
import { useTripAccommodations, useDeleteTripAccommodation } from '@/api/trip-accommodations';
// Budget components (Phase 21 Step 21.10)
import { BudgetCard } from '@/components/budget/BudgetCard';
import { BudgetEditSheet } from '@/components/budget/BudgetEditSheet';
import { CategoryBreakdown } from '@/components/budget/CategoryBreakdown';
import { ExpenseList } from '@/components/budget/ExpenseList';
import { ExpenseEditSheet } from '@/components/budget/ExpenseEditSheet';
// Accommodation components (Phase 21 Step 21.13)
import { AccommodationList } from '@/components/accommodation/AccommodationList';
import { AccommodationEditSheet } from '@/components/accommodation/AccommodationEditSheet';
import type { TripExpense } from '@/api/types';
import type { TripAccommodation } from '@/api/types';
// Phase 24: reactions
import { useTripReactions } from '@/api/trip-place-reactions';
import { useSession } from '@/api/auth';
// Phase 25 Step 25.7: cover picker
import { CoverPhotoSection } from './CoverPhotoSection';
import { CoverPickerModal } from './CoverPickerModal';

const CURRENCIES: TripCurrency[] = ['USD', 'EUR', 'GBP', 'TRY', 'JPY'];

export interface SettingsTabProps {
  tripId: string;
  tripStartDate: string | null;
  dailyHoursBudget: number;
  transportMode: TransportMode;
  currency: TripCurrency;
  hasPlaces: boolean;
  tripDayCount: number;
  canEdit: boolean;
  isOwner: boolean;
  /** Phase 25 Step 25.7: current cover photo place id, if set. */
  coverPhotoPlaceId: string | null;
  onDelete: () => void;
  deleting: boolean;
}

export function SettingsTab({
  tripId,
  tripStartDate,
  dailyHoursBudget,
  transportMode,
  currency,
  hasPlaces,
  tripDayCount,
  canEdit,
  isOwner,
  coverPhotoPlaceId,
  onDelete,
  deleting,
}: SettingsTabProps) {
  const t = useTheme();
  const router = useRouter();
  const [budget, setBudget] = useState(dailyHoursBudget);
  const [mode, setMode] = useState<TransportMode>(transportMode);

  // Phase 24 Step 24.5: liked/disliked catalog in SettingsTab.
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const { data: tripReactions = [] } = useTripReactions(tripId);
  const { data: tripPlaces = [] } = useTripPlaces(tripId);

  const likedPlaces = useMemo(() => {
    if (!currentUserId) return [];
    const myLikes = new Set(
      tripReactions
        .filter((r) => r.user_id === currentUserId && r.reaction === 'liked')
        .map((r) => r.trip_place_id),
    );
    return tripPlaces
      .filter((p) => myLikes.has(p.id))
      .sort((a, b) => (a.day_index ?? 999) - (b.day_index ?? 999) || (a.order_in_day ?? 0) - (b.order_in_day ?? 0));
  }, [tripReactions, tripPlaces, currentUserId]);

  const dislikedPlaces = useMemo(() => {
    if (!currentUserId) return [];
    const myDislikes = new Set(
      tripReactions
        .filter((r) => r.user_id === currentUserId && r.reaction === 'disliked')
        .map((r) => r.trip_place_id),
    );
    return tripPlaces
      .filter((p) => myDislikes.has(p.id))
      .sort((a, b) => (a.day_index ?? 999) - (b.day_index ?? 999) || (a.order_in_day ?? 0) - (b.order_in_day ?? 0));
  }, [tripReactions, tripPlaces, currentUserId]);

  // ── Budget state (Phase 21 Step 21.10) ──────────────────────────────────────
  const rollup = useTripExpenseRollup(tripId);
  // useTripExpenses is already subscribed by useTripExpenseRollup; this picks
  // up from the same cache key — zero extra network requests.
  const { data: expenses = [] } = useTripExpenses(tripId);
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<TripExpense | null>(null);
  const [expenseSheetOpen, setExpenseSheetOpen] = useState(false);
  const deleteExpense = useDeleteTripExpense();

  // ── Accommodation state (Phase 21 Step 21.13) ───────────────────────────────
  const { data: accommodations = [] } = useTripAccommodations(tripId);
  const deleteAccommodation = useDeleteTripAccommodation();
  const [editingAccommodation, setEditingAccommodation] = useState<TripAccommodation | null>(null);
  const [accommodationSheetOpen, setAccommodationSheetOpen] = useState(false);

  // ICS export state
  const downloadIcs = useDownloadTripIcs(tripId);
  const [icsStatus, setIcsStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  // ── Cover photo (Phase 25 Step 25.7) ──────────────────────────────────────
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);

  // ── Trip metadata mutations ───────────────────────────────────────────────
  // v2 Phase 0.1: the per-km travel-cost rate input (Step 8.6) was retired —
  // money is tracked via the category-based budget below, not km × rate.
  const updateTrip = useUpdateTrip(tripId);

  function handleCurrencyChange(value: TripCurrency) {
    updateTrip.mutate({ currency: value });
  }

  // Web Slider's <input type="range"> fires onChange per-tick during drag, so
  // debounce 500ms to avoid spamming the API. Native Slider is a stepper
  // (one tap = one fire), so the debounce is harmless there.
  const debouncedSaveBudget = useDebouncedCallback((v: number) => {
    updateTrip.mutate({ daily_hours_budget: v });
  }, 500);

  function commitBudget(v: number) {
    setBudget(v);
    debouncedSaveBudget(v);
  }
  function commitMode(v: TransportMode) {
    setMode(v);
    updateTrip.mutate({ transport_mode: v });
  }

  function confirmDelete() {
    if (Platform.OS === 'web') {
      // Platform-gated: window only touched on web (RNW-safe).
      if (typeof window !== 'undefined' && window.confirm('Delete this trip?')) onDelete();
      return;
    }
    Alert.alert('Delete trip?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  }

  async function handleExportIcs() {
    if (!hasPlaces) return;
    setIcsStatus('loading');
    try {
      await downloadIcs.mutateAsync();
      setIcsStatus('success');
      setTimeout(() => setIcsStatus('idle'), 3000);
    } catch {
      setIcsStatus('error');
      setTimeout(() => setIcsStatus('idle'), 4000);
    }
  }

  function icsButtonLabel() {
    switch (icsStatus) {
      case 'loading': return 'Exporting…';
      case 'success': return 'Downloaded!';
      case 'error': return 'Export failed — retry';
      default: return 'Export to calendar (.ics)';
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.lg }}>
      {/* ── Cover photo (Phase 25 Step 25.7) ────────────────────────────── */}
      <SectionHeading label="Cover photo" t={t} />
      <CoverPhotoSection
        tripId={tripId}
        coverPhotoPlaceId={coverPhotoPlaceId}
        canEdit={canEdit}
        onOpenPicker={() => setCoverPickerOpen(true)}
        onRemove={() => updateTrip.mutate({ cover_photo_google_place_id: null })}
      />

      {/* ── Trip settings ───────────────────────────────────────────────── */}
      {/* Step 5: "Daily plan time" is time-first language — it's hours of
          activities per day, not a financial budget. */}
      <Slider
        label="Daily plan time"
        unit="h"
        min={2}
        max={14}
        step={1}
        value={budget}
        onChange={commitBudget}
      />
      {/* Phase 23: bicycling added between walking and transit. */}
      <SegmentedControl<TransportMode>
        label="Transport mode"
        value={mode}
        onChange={commitMode}
        options={[
          { value: 'driving', label: 'Drive' },
          { value: 'walking', label: 'Walk' },
          { value: 'bicycling', label: 'Bike' },
          { value: 'transit', label: 'Transit' },
        ]}
      />

      {/* ── Budget (Phase 21 Step 21.10) ────────────────────────────────── */}
      {/* v2 Phase 0.1: the "Estimated travel cost" section (per-km rate input)
          was retired. The currency picker moved here — it now exclusively
          drives budget / expense formatting. */}
      <SectionHeading label="Budget" t={t} />
      {/* Phase 25 Step 25.11: currency is owner-only — editors cannot change it.
          The enforce_trips_column_restrictions trigger denies currency updates
          from non-owners. We gate the control in the UI to match. */}
      {isOwner ? (
        <SegmentedControl<TripCurrency>
          label="Currency"
          value={currency}
          onChange={handleCurrencyChange}
          options={CURRENCIES.map((c) => ({ value: c, label: c }))}
        />
      ) : (
        <View style={{ gap: t.spacing.xs }}>
          <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
            Currency
          </Text>
          <Text style={[t.typography.body, { color: t.colors.text }]}>{currency}</Text>
        </View>
      )}
      <BudgetCard
        rollup={rollup}
        currency={currency}
        onSetBudget={() => setBudgetSheetOpen(true)}
        canEdit={canEdit}
      />
      <CategoryBreakdown rollup={rollup} currency={currency} />
      <ExpenseList
        expenses={expenses}
        tripId={tripId}
        currency={currency}
        canEdit={canEdit}
        onAdd={() => {
          setEditingExpense(null);
          setExpenseSheetOpen(true);
        }}
        onEdit={(expense) => {
          setEditingExpense(expense);
          setExpenseSheetOpen(true);
        }}
        onDelete={(expense) => {
          deleteExpense.mutate({ id: expense.id, trip_id: tripId });
        }}
      />

      {/* ── Accommodation (Phase 21 Step 21.13) ─────────────────────────── */}
      <SectionHeading label="Accommodation" t={t} />
      <AccommodationList
        accommodations={accommodations}
        tripStartDate={tripStartDate}
        canEdit={canEdit}
        onAdd={() => {
          setEditingAccommodation(null);
          setAccommodationSheetOpen(true);
        }}
        onEdit={(acc) => {
          setEditingAccommodation(acc);
          setAccommodationSheetOpen(true);
        }}
        onDelete={(acc) => {
          deleteAccommodation.mutate({ id: acc.id, trip_id: tripId });
        }}
      />

      {/* ── Phase 24 Step 24.5: Liked / disliked catalog ────────────────── */}
      <ReactionCatalogSection
        label="You liked"
        places={likedPlaces}
        t={t}
        onOpenPlace={(googlePlaceId) => router.push(`/place/${googlePlaceId}` as never)}
      />
      <ReactionCatalogSection
        label="You didn't like"
        places={dislikedPlaces}
        t={t}
        onOpenPlace={(googlePlaceId) => router.push(`/place/${googlePlaceId}` as never)}
      />

      {/* ── Collaborators link ───────────────────────────────────────────── */}
      <SectionHeading label="Collaboration" t={t} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Manage collaborators"
        onPress={() => router.push(`/trip/${tripId}/collaborators` as never)}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: pressed ? t.colors.gradientSubtle : t.colors.bgElevated,
            borderColor: t.colors.border,
            borderRadius: t.radius.md,
            borderWidth: 1,
            padding: t.spacing.md,
          },
        ]}
      >
        <View style={{ gap: 2 }}>
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
            Manage collaborators
          </Text>
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            {isOwner ? 'Invite others to view or edit this trip' : 'View who has access to this trip'}
          </Text>
        </View>
        <Text style={{ fontSize: 18, color: t.colors.textMuted }}>›</Text>
      </Pressable>

      {/* ── Share ───────────────────────────────────────────────────────── */}
      <SectionHeading label="Share" t={t} />
      <ShareLinkCard tripId={tripId} />

      {/* Budget + Accommodation edit sheets */}
      <BudgetEditSheet
        tripId={tripId}
        currentBudget={rollup.budget}
        currency={currency}
        visible={budgetSheetOpen}
        onClose={() => setBudgetSheetOpen(false)}
      />
      <ExpenseEditSheet
        tripId={tripId}
        expense={editingExpense}
        currency={currency}
        visible={expenseSheetOpen}
        onClose={() => setExpenseSheetOpen(false)}
        tripDayCount={tripDayCount}
      />
      <AccommodationEditSheet
        tripId={tripId}
        accommodation={editingAccommodation}
        visible={accommodationSheetOpen}
        onClose={() => setAccommodationSheetOpen(false)}
      />

      {/* ── Calendar export ─────────────────────────────────────────────── */}
      <SectionHeading label="Export" t={t} />
      <View style={{ gap: t.spacing.sm }}>
        <Button
          label={icsButtonLabel()}
          variant="secondary"
          onPress={handleExportIcs}
          loading={icsStatus === 'loading'}
          disabled={!hasPlaces || icsStatus === 'loading'}
          accessibilityLabel={
            hasPlaces
              ? 'Export itinerary to calendar as ICS file'
              : 'Add places before exporting to calendar'
          }
          accessibilityState={{ disabled: !hasPlaces || icsStatus === 'loading' }}
        />
        {!hasPlaces ? (
          <Text
            style={[t.typography.caption, { color: t.colors.textMuted }]}
            accessibilityLiveRegion="polite"
          >
            Add at least one place to enable calendar export.
          </Text>
        ) : null}
        {icsStatus === 'error' ? (
          <Text
            style={[t.typography.caption, { color: t.colors.danger }]}
            accessibilityLiveRegion="assertive"
          >
            Export failed. Please try again.
          </Text>
        ) : null}
      </View>

      {/* ── Danger zone ─────────────────────────────────────────────────── */}
      <SectionHeading label="Danger zone" t={t} />
      <Button variant="danger" label="Delete trip" onPress={confirmDelete} loading={deleting} />

      {/* ── Cover picker modal ──────────────────────────────────────────── */}
      <CoverPickerModal
        tripId={tripId}
        visible={coverPickerOpen}
        onClose={() => setCoverPickerOpen(false)}
        onSelect={(placeId) => {
          updateTrip.mutate({ cover_photo_google_place_id: placeId });
          setCoverPickerOpen(false);
        }}
      />
    </ScrollView>
  );
}

/**
 * Liked / disliked catalog section (Phase 24 Step 24.5).
 *
 * v1 had this block duplicated verbatim for "You liked" and "You didn't
 * like"; the markup below is byte-identical to both originals — only the
 * heading label and source array vary. Renders nothing when empty (same as
 * v1's `length > 0 ? … : null`).
 */
function ReactionCatalogSection({
  label,
  places,
  t,
  onOpenPlace,
}: {
  label: string;
  places: TripPlace[];
  t: ReturnType<typeof useTheme>;
  onOpenPlace: (googlePlaceId: string) => void;
}) {
  if (places.length === 0) return null;
  return (
    <>
      <SectionHeading label={label} t={t} />
      {places.map((place) => (
        <Pressable
          key={place.id}
          accessibilityRole="button"
          accessibilityLabel={`View details for ${place.user_title ?? 'place'}`}
          onPress={() => onOpenPlace(place.google_place_id)}
          style={({ pressed }) => [
            {
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: pressed ? t.colors.gradientSubtle : t.colors.bgElevated,
              borderColor: t.colors.border,
              borderRadius: t.radius.md,
              borderWidth: 1,
              padding: t.spacing.md,
              gap: t.spacing.sm,
            },
          ]}
        >
          <Text style={[t.typography.body, { color: t.colors.text, flex: 1 }]} numberOfLines={1}>
            {place.user_title ?? 'Unknown place'}
          </Text>
          {place.day_index !== null ? (
            <View
              style={{
                backgroundColor: dayColor(place.day_index),
                borderRadius: t.radius.pill,
                paddingHorizontal: t.spacing.sm,
                paddingVertical: 2,
              }}
            >
              <Text style={[t.typography.small, { color: '#fff' }]}>
                {`Day ${place.day_index + 1}`}
              </Text>
            </View>
          ) : null}
          <Text style={{ fontSize: 14, color: t.colors.textMuted }}>›</Text>
        </Pressable>
      ))}
    </>
  );
}

/** Small inline section heading used inside the Settings scroll view. */
function SectionHeading({ label, t }: { label: string; t: ReturnType<typeof useTheme> }) {
  return (
    <Text
      style={[t.typography.subtitle, { color: t.colors.text }]}
      accessibilityRole="header"
      aria-level={3}
    >
      {label}
    </Text>
  );
}
