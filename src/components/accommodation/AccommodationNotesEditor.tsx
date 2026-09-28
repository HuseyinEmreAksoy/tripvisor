/**
 * AccommodationNotesEditor — inline notes for a stay (Phase 25 Step 25.10;
 * extracted from AccommodationCard in v2 M4 X2.4).
 *
 * Viewers see existing notes read-only (nothing when empty); editors tap to
 * edit and the note saves on blur. The "Confirmation: CODE" line is hidden in
 * the read view (the card shows it as a copyable code) but kept in the raw
 * text while editing, so saving never drops it.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { useTheme } from '@/theme';
import { useUpdateTripAccommodation } from '@/api/trip-accommodations';
import type { TripAccommodation } from '@/api/types';
import { stripConfirmationLine } from './stayUtils';

export function AccommodationNotesEditor({
  accommodation,
  canEdit,
}: {
  accommodation: TripAccommodation;
  canEdit: boolean;
}) {
  const t = useTheme();
  const updateAcc = useUpdateTripAccommodation();
  const [focused, setFocused] = useState(false);
  const [localText, setLocalText] = useState(accommodation.notes ?? '');

  useEffect(() => {
    setLocalText(accommodation.notes ?? '');
  }, [accommodation.notes]);

  function handleBlur() {
    setFocused(false);
    const trimmed = localText.trim();
    const next = trimmed.length > 0 ? trimmed : null;
    if (next !== accommodation.notes) {
      updateAcc.mutate({ id: accommodation.id, notes: next });
    }
  }

  const displayText = stripConfirmationLine(localText) ?? '';

  if (!canEdit) {
    if (!displayText) return null;
    return (
      <Text style={[t.typography.caption, { color: t.colors.textMuted }]} numberOfLines={3}>
        {displayText}
      </Text>
    );
  }

  if (focused) {
    return (
      <TextInput
        multiline
        numberOfLines={3}
        maxLength={2000}
        value={localText}
        onChangeText={setLocalText}
        onBlur={handleBlur}
        placeholder="Add notes…"
        placeholderTextColor={t.colors.textMuted}
        accessibilityLabel={`Notes for accommodation: ${accommodation.name}`}
        style={[
          styles.input,
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
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        displayText ? `Notes: ${displayText.slice(0, 60)}. Tap to edit.` : `Add note for ${accommodation.name}`
      }
      onPress={() => setFocused(true)}
      style={styles.tapArea}
    >
      <Text
        style={[t.typography.caption, { color: displayText ? t.colors.textMuted : t.colors.primaryInk }]}
        numberOfLines={displayText ? 2 : undefined}
      >
        {displayText || 'Add note…'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  tapArea: { minHeight: 32, justifyContent: 'center' },
});
