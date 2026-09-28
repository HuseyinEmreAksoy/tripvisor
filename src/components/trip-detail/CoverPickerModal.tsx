/**
 * CoverPickerModal (Phase 25 Step 25.7) — extracted from
 * app/(app)/trip/[id]/index.tsx in v2 Phase N1 step 1.1 (pure refactor).
 *
 * Lists all trip_places. Each row shows place name + small thumbnail.
 * Tapping a place calls onSelect(googlePlaceId) → parent calls useUpdateTrip.
 *
 * Keeps its own hooks — v1 already fetched inside this block:
 * useTripPlaces (row list; TanStack dedupes against the route shell's
 * subscription) and the Tier-2 photo hooks in CoverPickerRow.
 */
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useOptionalSafeAreaInsets } from '@/hooks/useOptionalSafeAreaInsets';
import { useTheme } from '@/theme';
import { Icon } from '@/components/Icon';
import { useTripPlaces, type TripPlace } from '@/api';
import { usePlaceDetails } from '@/api/places';
import { usePlacePhotoUrl } from '@/api/place-photos';

export function CoverPickerModal({
  tripId,
  visible,
  onClose,
  onSelect,
}: {
  tripId: string;
  visible: boolean;
  onClose: () => void;
  onSelect: (placeId: string) => void;
}) {
  const t = useTheme();
  const insets = useOptionalSafeAreaInsets();
  const { data: placesForPicker = [] } = useTripPlaces(tripId);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      // X3.1: draw under the system bars like the rest of the app
      // (Android edge-to-edge) and pad the home indicator via insets.
      statusBarTranslucent
      navigationBarTranslucent
      accessibilityViewIsModal
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.scrim }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close cover photo picker"
        />
        <View
          style={{
            backgroundColor: t.colors.bgElevated,
            borderTopLeftRadius: t.radius.xl,
            borderTopRightRadius: t.radius.xl,
            maxHeight: '70%',
            paddingBottom: Math.max(insets.bottom, t.spacing.lg),
          }}
          accessible
          accessibilityLabel="Choose cover photo"
        >
          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: t.spacing.lg,
              borderBottomWidth: 1,
              borderBottomColor: t.colors.border,
            }}
          >
            <Text style={[t.typography.subtitle, { color: t.colors.text }]}>
              Choose cover photo
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close cover photo picker"
              onPress={onClose}
              hitSlop={6}
              style={({ pressed }) => [
                {
                  width: 36,
                  height: 36,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: t.radius.pill,
                  backgroundColor: pressed ? t.colors.bgMuted : 'transparent',
                },
              ]}
            >
              <Icon name="x" size={20} color={t.colors.textMuted} />
            </Pressable>
          </View>

          {placesForPicker.length === 0 ? (
            <View style={{ padding: t.spacing.lg }}>
              <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
                Add places to the trip first.
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: t.spacing.md, gap: t.spacing.sm }}>
              {placesForPicker.map((place) => (
                <CoverPickerRow
                  key={place.id}
                  place={place}
                  onSelect={() => onSelect(place.google_place_id)}
                />
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function CoverPickerRow({
  place,
  onSelect,
}: {
  place: TripPlace;
  onSelect: () => void;
}) {
  const t = useTheme();
  const { data: details } = usePlaceDetails({
    placeId: place.google_place_id,
    fields: ['photos'],
    enabled: Boolean(place.google_place_id),
  });
  const firstName = details?.photos?.[0]?.name ?? null;
  const { url } = usePlacePhotoUrl(firstName, { maxWidthPx: 100 });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Set ${place.user_title ?? 'place'} as cover photo`}
      onPress={onSelect}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing.sm,
          padding: t.spacing.sm,
          borderRadius: t.radius.md,
          backgroundColor: pressed ? t.colors.gradientSubtle : t.colors.bgElevated,
          borderWidth: 1,
          borderColor: t.colors.border,
        },
      ]}
    >
      {/* Thumbnail */}
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: t.radius.sm,
          overflow: 'hidden',
          backgroundColor: t.colors.bgMuted,
          flexShrink: 0,
        }}
      >
        {url ? (
          <Image
            source={{ uri: url }}
            style={{ width: 44, height: 44 }}
            resizeMode="cover"
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        ) : null}
      </View>
      <Text
        style={[t.typography.body, { color: t.colors.text, flex: 1 }]}
        numberOfLines={1}
      >
        {place.user_title ?? 'Place'}
      </Text>
      <Text style={{ fontSize: 16, color: t.colors.textMuted }}>›</Text>
    </Pressable>
  );
}
