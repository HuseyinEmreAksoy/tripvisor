/**
 * TripSettingsSheet — trip-level settings, opened from the header ⋯ menu
 * (v2 M4 X2.2). Split out of the old SettingsTab: the JSX below was MOVED,
 * not rewritten (parity risk mitigation), so behavior matches v1.
 *
 * Sections: cover photo · dates (read-only, see note) · daily plan time ·
 * transport mode · currency (owner-only) · calendar (.ics) export · danger
 * zone (owner-only delete).
 *
 * The trip-content surfaces (budget, stays, packing, docs, people, share,
 * reactions) moved to TripHubTab.
 *
 * Dates: `UpdateTripPatch` has no start/end date fields yet (src/api is
 * backend-owned), so dates show read-only here.
 */
import { useState } from 'react';
import { Alert, Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { BottomSheet, Button, Heading, SegmentedControl, Slider } from '@/components';
import { useTheme } from '@/theme';
import { useDebouncedCallback } from '@/lib/hooks/useDebouncedCallback';
// Metro resolves ics.native.ts on native, ics.web.ts on web automatically.
import { useDownloadTripIcs } from '@/api/ics';
import { useUpdateTrip, type TransportMode, type TripCurrency } from '@/api';
import { CoverPhotoSection } from './CoverPhotoSection';
import { CoverPickerModal } from './CoverPickerModal';
import { SectionHeading } from './TripHubCards';

const CURRENCIES: TripCurrency[] = ['USD', 'EUR', 'GBP', 'TRY', 'JPY'];

export interface TripSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  tripId: string;
  startDate: string | null;
  endDate: string | null;
  dailyHoursBudget: number;
  transportMode: TransportMode;
  currency: TripCurrency;
  hasPlaces: boolean;
  canEdit: boolean;
  isOwner: boolean;
  coverPhotoPlaceId: string | null;
  onDelete: () => void;
  deleting: boolean;
  /** Shown under the Delete button when the last delete attempt failed. */
  deleteError?: string | null;
}

export function TripSettingsSheet(props: TripSettingsSheetProps) {
  const { visible, onClose } = props;
  const { height } = useWindowDimensions();
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel="Trip settings">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Heading level={2}>Trip settings</Heading>
        <Button
          label="Done"
          variant="ghost"
          fullWidth={false}
          onPress={onClose}
          accessibilityLabel="Close trip settings"
        />
      </View>
      {/* Mounted only while visible, so local slider state re-seeds from the
          trip on every open. */}
      {visible ? (
        <ScrollView style={{ maxHeight: Math.round(height * 0.7) }}>
          <TripSettingsBody {...props} />
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}

function TripSettingsBody({
  tripId,
  startDate,
  endDate,
  dailyHoursBudget,
  transportMode,
  currency,
  hasPlaces,
  canEdit,
  isOwner,
  coverPhotoPlaceId,
  onDelete,
  deleting,
  deleteError = null,
}: TripSettingsSheetProps) {
  const t = useTheme();
  const [budget, setBudget] = useState(dailyHoursBudget);
  const [mode, setMode] = useState<TransportMode>(transportMode);

  // ICS export state
  const downloadIcs = useDownloadTripIcs(tripId);
  const [icsStatus, setIcsStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  // ── Cover photo (Phase 25 Step 25.7) ──────────────────────────────────────
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);

  // ── Trip metadata mutations ───────────────────────────────────────────────
  // v2 Phase 0.1: the per-km travel-cost rate input (Step 8.6) was retired —
  // money is tracked via the category-based budget, not km × rate.
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
    <View style={{ gap: t.spacing.lg, paddingBottom: t.spacing.md }}>
      {/* ── Cover photo (Phase 25 Step 25.7) ────────────────────────────── */}
      <SectionHeading label="Cover photo" />
      <CoverPhotoSection
        tripId={tripId}
        coverPhotoPlaceId={coverPhotoPlaceId}
        canEdit={canEdit}
        onOpenPicker={() => setCoverPickerOpen(true)}
        onRemove={() => updateTrip.mutate({ cover_photo_google_place_id: null })}
      />

      {/* ── Dates (read-only until the API accepts date patches) ────────── */}
      <View style={{ gap: t.spacing.xs }}>
        <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
          Dates
        </Text>
        <Text style={[t.typography.body, { color: t.colors.text }]}>
          {startDate && endDate ? `${startDate} → ${endDate}` : startDate ?? endDate ?? 'No dates set'}
        </Text>
      </View>

      {/* ── Trip settings ───────────────────────────────────────────────── */}
      {/* Step 5: "Daily plan time" is time-first language — it's hours of
          activities per day, not a financial budget. X2.2: editors only —
          viewers see the values read-only. */}
      {canEdit ? (
        <>
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
        </>
      ) : (
        <ReadOnlyValue label="Daily plan time · transport" value={`${budget}h/day · ${mode}`} />
      )}

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
        <ReadOnlyValue label="Currency" value={currency} />
      )}

      {/* ── Calendar export ─────────────────────────────────────────────── */}
      <SectionHeading label="Export" />
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
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          Your full account export (JSON) is in the Profile tab.
        </Text>
      </View>

      {/* ── Danger zone (owner-only: RLS rejects a collaborator delete) ─── */}
      {isOwner ? (
        <>
          <SectionHeading label="Danger zone" />
          <Button variant="danger" label="Delete trip" onPress={confirmDelete} loading={deleting} />
          {deleteError ? (
            <Text
              style={[t.typography.caption, { color: t.colors.danger }]}
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
            >
              {deleteError}
            </Text>
          ) : null}
        </>
      ) : null}

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
    </View>
  );
}

function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
        {label}
      </Text>
      <Text style={[t.typography.body, { color: t.colors.text }]}>{value}</Text>
    </View>
  );
}
