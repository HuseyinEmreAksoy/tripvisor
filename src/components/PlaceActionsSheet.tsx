import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Heading } from './Heading';
import { VisitDurationStepper } from './VisitDurationStepper';
import { useTheme } from '@/theme';
import type { TripPlace, Uuid } from '@/api';
import { useDeleteTripPlace, useMoveToDay, useUpdateTripPlace } from '@/api';

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
});
