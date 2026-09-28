/**
 * Notes editors for the trip detail itinerary (extracted from
 * app/(app)/trip/[id]/index.tsx in v2 Phase N1 step 1.1 — pure refactor).
 *
 *  - DayNotesEditor   — per-day notes (Step 9.5), rendered under each day header.
 *  - PlaceNotesEditor — per-place notes (Step 9.4 / 25.10), rendered under each
 *    place card by PlaceRow.
 *
 * Both follow the same pattern: collapsed preview → tap to expand into a
 * multiline TextInput → 500ms debounced write via the relevant mutation hook.
 * They keep their own mutation hooks (useUpdateTripDay / useUpdateTripPlace)
 * because v1 already had those hooks inside these blocks; data still flows
 * down as props (dayRecord / place).
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/theme';
import { useDebouncedCallback } from '@/lib/hooks/useDebouncedCallback';
import { useUpdateTripDay, useUpdateTripPlace, type TripDay, type TripPlace } from '@/api';

// ── DayNotesEditor (Step 9.5) ────────────────────────────────────────────────
//
// Design: Option A inline — collapsed Pressable "Add notes for this day" when
// empty, or a truncated first line when populated. Tap to expand into a
// multi-line TextInput. 500ms debounced write via useUpdateTripDay().

export function DayNotesEditor({
  tripId,
  dayIndex,
  dayRecord,
}: {
  tripId: string;
  dayIndex: number;
  dayRecord: TripDay | null;
}) {
  const t = useTheme();
  const updateDay = useUpdateTripDay();
  const persistedNotes = dayRecord?.notes ?? null;

  const [expanded, setExpanded] = useState(false);
  // Local text mirrors the persisted notes; synced when the persisted value
  // changes from the server (e.g. another device write / optimistic flush).
  const [localText, setLocalText] = useState(persistedNotes ?? '');

  // Keep local text in sync with server state when notes are updated externally.
  useEffect(() => {
    setLocalText(persistedNotes ?? '');
  }, [persistedNotes]);

  const debouncedSave = useDebouncedCallback((value: string) => {
    const trimmed = value.trim();
    updateDay.mutate({
      trip_id: tripId,
      day_index: dayIndex,
      notes: trimmed.length > 0 ? trimmed : null,
    });
  }, 500);

  function handleChange(text: string) {
    setLocalText(text);
    debouncedSave(text);
  }

  const hasNotes = Boolean(localText.trim());

  // The collapsed preview: first line of text, truncated to one line.
  const previewText = hasNotes
    ? (localText.split('\n')[0] ?? '').slice(0, 80)
    : null;

  if (!expanded) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          hasNotes
            ? `Day ${dayIndex + 1} notes: ${previewText}. Tap to edit.`
            : `Add notes for Day ${dayIndex + 1}`
        }
        onPress={() => setExpanded(true)}
        style={[
          styles.dayNotesCollapsed,
          {
            borderColor: t.colors.border,
            borderRadius: t.radius.sm,
            backgroundColor: t.colors.bgElevated,
            padding: t.spacing.sm,
          },
        ]}
      >
        <Text
          style={[
            t.typography.caption,
            { color: hasNotes ? t.colors.text : t.colors.textMuted },
          ]}
          numberOfLines={1}
        >
          {hasNotes ? previewText : 'Add notes for this day…'}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={{ gap: t.spacing.xs }}>
      <TextInput
        multiline
        numberOfLines={4}
        maxLength={2000}
        value={localText}
        onChangeText={handleChange}
        onBlur={() => debouncedSave.flush()}
        placeholder="Add notes for this day (up to 2000 characters)"
        placeholderTextColor={t.colors.textMuted}
        accessibilityLabel={`Notes for Day ${dayIndex + 1}`}
        style={[
          styles.notesInput,
          {
            borderColor: t.colors.border,
            borderRadius: t.radius.sm,
            backgroundColor: t.colors.bgElevated,
            color: t.colors.text,
            ...t.typography.caption,
          },
        ]}
        autoFocus
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Collapse day notes"
        onPress={() => setExpanded(false)}
        style={{ alignSelf: 'flex-end' }}
      >
        <Text style={[t.typography.caption, { color: t.colors.primaryInk }]}>Done</Text>
      </Pressable>
    </View>
  );
}

// ── PlaceNotesEditor (Step 9.4) ───────────────────────────────────────────────
//
// Surface: Option A (inline, below the place card title row).
// Rationale: the place card already has a natural content area under the title
// and category line. Inlining here avoids opening an extra bottom sheet and
// gives the user immediate visual feedback without a tap-to-open gesture.
// On a 360px-wide viewport the notes field is comfortably within the card
// width; numberOfLines={4} keeps vertical growth bounded.
//
// Debounced 500ms write via useUpdateTripPlace(); empty string saved as null.

const NOTES_COLLAPSE_THRESHOLD = 120;

export function PlaceNotesEditor({ place, canEdit = true }: { place: TripPlace; canEdit?: boolean }) {
  const t = useTheme();
  const updatePlace = useUpdateTripPlace();
  const [focused, setFocused] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [localText, setLocalText] = useState(place.notes ?? '');

  // Sync from server when the notes prop changes (cache invalidation).
  useEffect(() => {
    setLocalText(place.notes ?? '');
  }, [place.notes]);

  const debouncedSave = useDebouncedCallback((value: string) => {
    const trimmed = value.trim();
    updatePlace.mutate({
      id: place.id,
      trip_id: place.trip_id,
      notes: trimmed.length > 0 ? trimmed : null,
    });
  }, 500);

  function handleChange(text: string) {
    setLocalText(text);
    debouncedSave(text);
  }

  // Show-more / show-less logic: only applies when NOT focused and text > 120 chars.
  const isLong = !focused && localText.length > NOTES_COLLAPSE_THRESHOLD;
  const displayText =
    isLong && !showMore
      ? localText.slice(0, NOTES_COLLAPSE_THRESHOLD) + '…'
      : localText;

  // If viewer (canEdit = false) and no notes — render nothing (keeps list tight).
  if (!canEdit && !localText) return null;

  return (
    <View style={{ gap: t.spacing.xs, paddingHorizontal: t.spacing.xs }}>
      {focused && canEdit ? (
        <TextInput
          multiline
          numberOfLines={4}
          maxLength={2000}
          value={localText}
          onChangeText={handleChange}
          onBlur={() => { debouncedSave.flush(); setFocused(false); }}
          placeholder="Add notes (up to 2000 characters)"
          placeholderTextColor={t.colors.textMuted}
          accessibilityLabel={`Notes for ${place.user_title ?? 'place'}`}
          style={[
            styles.notesInput,
            {
              borderColor: t.colors.border,
              borderRadius: t.radius.sm,
              backgroundColor: t.colors.bg,
              color: t.colors.text,
              ...t.typography.caption,
            },
          ]}
          autoFocus
        />
      ) : (
        <Pressable
          accessibilityRole={canEdit ? 'button' : 'text'}
          accessibilityLabel={
            localText
              ? `Notes for ${place.user_title ?? 'place'}: ${localText.slice(0, 60)}.${canEdit ? ' Tap to edit.' : ''}`
              : `Add notes for ${place.user_title ?? 'place'}`
          }
          onPress={canEdit ? () => setFocused(true) : undefined}
        >
          <Text
            accessibilityRole="text"
            style={[
              t.typography.caption,
              { color: localText ? t.colors.text : t.colors.textMuted },
            ]}
          >
            {localText ? displayText : 'Add notes…'}
          </Text>
        </Pressable>
      )}

      {/* Show more / show less toggle */}
      {isLong ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showMore ? 'Show less notes' : 'Show more notes'}
          onPress={() => setShowMore((v) => !v)}
        >
          <Text style={[t.typography.caption, { color: t.colors.primaryInk }]}>
            {showMore ? 'Show less' : 'Show more'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Per-place and per-day notes inputs (Steps 9.4 + 9.5)
  notesInput: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 80,
    textAlignVertical: 'top', // Android: start text from the top of the multiline field
  },
  dayNotesCollapsed: {
    borderWidth: 1,
  },
});
