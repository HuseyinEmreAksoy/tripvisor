import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Heading } from './Heading';
import { Icon } from './Icon';
import { VisitDurationStepper } from './VisitDurationStepper';
import { useTheme } from '@/theme';
import type { TripPlace, Uuid } from '@/api';
import { useDeleteTripPlace, useMoveToDay, useUpdateTripPlace } from '@/api';
import {
  formatClockTime,
  parseTimeOfDay,
} from './trip-detail/computeDayTimeline';

export interface PlaceActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  place: TripPlace | null;
  /** Distinct day indices that currently exist on the trip. */
  availableDays: number[];
}

export function PlaceActionsSheet({
  visible,
  onClose,
  place,
  availableDays,
}: PlaceActionsSheetProps) {
  const t = useTheme();
  const updatePlace = useUpdateTripPlace();
  const moveToDay = useMoveToDay();
  const deletePlace = useDeleteTripPlace();

  if (!place) return null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel={`Actions for ${place.user_title ?? 'place'}`}
    >
      <ScrollView contentContainerStyle={{ gap: t.spacing.md }}>
        <Heading level={3}>{place.user_title ?? 'Place'}</Heading>

        <VisitDurationStepper
          minutes={place.visit_duration_minutes}
          onChange={(v) =>
            updatePlace.mutate({
              id: place.id,
              trip_id: place.trip_id,
              visit_duration_minutes: v,
            })
          }
        />

        <MoveToDay
          currentDayIndex={place.day_index}
          availableDays={availableDays}
          onMove={(toDay) => {
            moveToDay.mutate({
              id: place.id,
              tripId: place.trip_id,
              toDayIndex: toDay,
            });
          }}
        />

        {/* v2 P1.1a: user-set time window. Keyed by place id so drafts reset
            when the sheet is reused for a different place. */}
        <TimeWindowEditor key={place.id} place={place} />

        <Button
          variant="danger"
          label="Delete this place"
          loading={deletePlace.isPending}
          onPress={() => confirmDelete(place.id, place.trip_id, deletePlace.mutate, onClose)}
        />

        <Button variant="ghost" label="Close" onPress={onClose} />
      </ScrollView>
    </BottomSheet>
  );
}

function MoveToDay({
  currentDayIndex,
  availableDays,
  onMove,
}: {
  currentDayIndex: number | null;
  availableDays: number[];
  onMove: (toDay: number) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);

  const targets = [...availableDays];
  // Offer a new-day slot: current max + 1, capped at 9 for MVP.
  const maxDay = targets.length > 0 ? Math.max(...targets) : -1;
  if (maxDay < 9) targets.push(maxDay + 1);

  return (
    <View style={{ gap: t.spacing.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Move to a different day"
        onPress={() => setOpen((v) => !v)}
        style={[
          styles.expander,
          {
            backgroundColor: t.colors.bgElevated,
            borderColor: t.colors.border,
            borderRadius: t.radius.md,
            padding: t.spacing.md,
          },
        ]}
      >
        <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>Move to day</Text>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          Currently: {currentDayIndex == null || currentDayIndex < 0 ? 'Unscheduled' : `Day ${currentDayIndex + 1}`}
        </Text>
      </Pressable>
      {open ? (
        <View
          accessibilityRole="radiogroup"
          style={{ gap: t.spacing.xs }}
        >
          {targets.map((day) => {
            const active = day === currentDayIndex;
            return (
              <Pressable
                key={day}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Day ${day + 1}`}
                onPress={() => {
                  if (!active) onMove(day);
                  setOpen(false);
                }}
                style={[
                  styles.dayRow,
                  {
                    borderColor: active ? t.colors.primary : t.colors.border,
                    backgroundColor: active ? t.colors.bgElevated : 'transparent',
                    borderRadius: t.radius.md,
                    paddingVertical: t.spacing.md,
                    paddingHorizontal: t.spacing.md,
                  },
                ]}
              >
                <Text style={[t.typography.body, { color: t.colors.text }]}>
                  Day {day + 1}
                  {day === (availableDays[availableDays.length - 1] ?? -1) + 1 ? ' (new)' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ── TimeWindowEditor (v2 P1.1a) ──────────────────────────────────────────────
//
// Optional "arrive after" / "leave before" bounds for one place. Collapsed:
// an expander row summarizing the current window. Expanded: two HH:MM inputs
// with per-field Clear buttons and an explicit Save.
//
// ToS invariant: values are MANUAL USER INPUT only — never auto-filled from
// Google opening hours (live hours are Tier-2 memory-only; the place-detail
// screen is where users read them as reference). Hence no "use opening
// hours" shortcut here, by design.
//
// The DB enforces `leave_before > arrive_after` when both are set
// (trip_places_time_window_check); we pre-validate client-side and translate
// the constraint error into friendly copy if a stale partial update slips
// through (the hook can't see the other column on partial writes).

/** "HH:MM:SS" wire value → "HH:MM" label, or null when unset/unparseable. */
function timeWindowLabel(value: string | null): string | null {
  const minutes = parseTimeOfDay(value);
  return minutes === null ? null : formatClockTime(minutes);
}

/** Validate one draft field: '' = cleared (ok), else strict HH:MM (24h). */
function isValidDraft(text: string): boolean {
  return text === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(text.trim());
}

function TimeWindowEditor({ place }: { place: TripPlace }) {
  const t = useTheme();
  const updatePlace = useUpdateTripPlace();
  const [open, setOpen] = useState(false);
  // Drafts seeded from the server value once (component is keyed by place.id,
  // so a different place remounts with fresh seeds — no server-state mirror).
  const [arriveDraft, setArriveDraft] = useState(() => timeWindowLabel(place.arrive_after) ?? '');
  const [leaveDraft, setLeaveDraft] = useState(() => timeWindowLabel(place.leave_before) ?? '');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const arriveLabel = timeWindowLabel(place.arrive_after);
  const leaveLabel = timeWindowLabel(place.leave_before);
  const summary =
    arriveLabel && leaveLabel
      ? `${arriveLabel} – ${leaveLabel}`
      : arriveLabel
        ? `Arrive after ${arriveLabel}`
        : leaveLabel
          ? `Leave before ${leaveLabel}`
          : 'No window — times are flexible';

  function save() {
    const arrive = arriveDraft.trim();
    const leave = leaveDraft.trim();
    if (!isValidDraft(arrive) || !isValidDraft(leave)) {
      setFieldError('Use 24h HH:MM, e.g. 09:30 — or clear the field.');
      return;
    }
    // Cross-field rule, validated client-side ahead of the DB CHECK.
    const arriveMin = arrive === '' ? null : parseTimeOfDay(arrive);
    const leaveMin = leave === '' ? null : parseTimeOfDay(leave);
    if (arriveMin !== null && leaveMin !== null && leaveMin <= arriveMin) {
      setFieldError('"Leave before" must be later than "arrive after".');
      return;
    }
    setFieldError(null);
    setSaved(false);
    updatePlace.mutate(
      {
        id: place.id,
        trip_id: place.trip_id,
        arrive_after: arrive === '' ? null : arrive, // 'HH:MM' or null clears
        leave_before: leave === '' ? null : leave,
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  // Friendly translation of the DB CHECK violation (and a generic fallback).
  const saveError = updatePlace.isError
    ? /time_window/i.test(updatePlace.error?.message ?? '')
      ? '"Leave before" must be later than "arrive after" — the window wasn\'t saved.'
      : "Couldn't save the time window — check your connection and try again."
    : null;

  return (
    <View style={{ gap: t.spacing.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Time window. Currently: ${summary}. ${open ? 'Collapse' : 'Expand to edit'}.`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={[
          styles.expander,
          {
            backgroundColor: t.colors.bgElevated,
            borderColor: t.colors.border,
            borderRadius: t.radius.md,
            padding: t.spacing.md,
          },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {/* v3: Lucide alarm-clock replaces ⏰ (functional control lead). */}
          <Icon name="alarm-clock" size={18} color={t.colors.primary} />
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>Time window</Text>
        </View>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>{summary}</Text>
      </Pressable>

      {open ? (
        <View style={{ gap: t.spacing.sm }}>
          <TimeWindowField
            label="Arrive after"
            placeholder="e.g. 10:00"
            value={arriveDraft}
            onChange={(text) => {
              setArriveDraft(text);
              setFieldError(null);
              setSaved(false);
            }}
            onClear={() => {
              setArriveDraft('');
              setFieldError(null);
              setSaved(false);
            }}
          />
          <TimeWindowField
            label="Leave before"
            placeholder="e.g. 17:00"
            value={leaveDraft}
            onChange={(text) => {
              setLeaveDraft(text);
              setFieldError(null);
              setSaved(false);
            }}
            onClear={() => {
              setLeaveDraft('');
              setFieldError(null);
              setSaved(false);
            }}
          />

          {fieldError ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[t.typography.small, { color: t.colors.danger }]}
            >
              {fieldError}
            </Text>
          ) : null}
          {saveError && !fieldError ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[t.typography.small, { color: t.colors.danger }]}
            >
              {saveError}
            </Text>
          ) : null}
          {saved && !updatePlace.isPending && !fieldError ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[t.typography.small, { color: t.colors.textMuted }]}
            >
              Time window saved.
            </Text>
          ) : null}

          <Button
            label={updatePlace.isPending ? 'Saving…' : 'Save window'}
            loading={updatePlace.isPending}
            onPress={save}
          />

          {/* ToS posture made visible: manual entry only, hours are reference. */}
          <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
            Tip: check opening hours on the place's detail page — you choose the
            window yourself; it's never filled in automatically.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function TimeWindowField({
  label,
  placeholder,
  value,
  onChange,
  onClear,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (text: string) => void;
  onClear: () => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.timeFieldRow, { gap: t.spacing.sm }]}>
      <Text style={[t.typography.body, { color: t.colors.text, flex: 1 }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.colors.textMuted}
        accessibilityLabel={`${label} time, 24 hour format hours colon minutes. Leave empty for no limit.`}
        keyboardType={Platform.OS === 'web' ? undefined : 'numbers-and-punctuation'}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={5}
        style={[
          styles.timeInput,
          t.typography.body,
          {
            borderColor: t.colors.border,
            borderRadius: t.radius.sm,
            backgroundColor: t.colors.bgElevated,
            color: t.colors.text,
          },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Clear the ${label.toLowerCase()} time`}
        onPress={onClear}
        disabled={value === ''}
        hitSlop={6}
        style={{ opacity: value === '' ? 0.35 : 1 }}
      >
        <Text style={[t.typography.body, { color: t.colors.primary }]}>Clear</Text>
      </Pressable>
    </View>
  );
}

function confirmDelete(
  id: Uuid,
  tripId: Uuid,
  mutate: (args: { id: Uuid; trip_id: Uuid }) => void,
  onClose: () => void,
) {
  const run = () => {
    mutate({ id, trip_id: tripId });
    onClose();
  };
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm('Remove this place from the trip?')) run();
    return;
  }
  Alert.alert('Remove place?', 'You can re-add it later.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: run },
  ]);
}

const styles = StyleSheet.create({
  expander: { borderWidth: 1 },
  dayRow: { borderWidth: 1 },
  // v2 P1.1a: time-window editor rows
  timeFieldRow: { flexDirection: 'row', alignItems: 'center' },
  timeInput: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 76,
    textAlign: 'center',
  },
});
