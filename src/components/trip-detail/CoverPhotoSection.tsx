/**
 * CoverPhotoSection (Phase 25 Step 25.7) — extracted from
 * app/(app)/trip/[id]/index.tsx in v2 Phase N1 step 1.1 (pure refactor).
 *
 * Shows current cover preview + Set/Change/Remove buttons.
 * Rendered inside TripSettingsSheet (v2 M4 X2.2; formerly the SettingsTab ScrollView).
 *
 * Keeps its own Tier-2 hooks (usePlaceDetails / usePlacePhotoUrl) — v1
 * already fetched the preview photo here; photo URLs are memory-only
 * (ToS firewall), never persisted.
 */
import { Image, Pressable, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { usePlaceDetails } from '@/api/places';
import { usePlacePhotoUrl } from '@/api/place-photos';

export function CoverPhotoSection({
  tripId: _tripId,
  coverPhotoPlaceId,
  canEdit,
  onOpenPicker,
  onRemove,
}: {
  tripId: string;
  coverPhotoPlaceId: string | null;
  canEdit: boolean;
  onOpenPicker: () => void;
  onRemove: () => void;
}) {
  const t = useTheme();
  const { data: coverDetails } = usePlaceDetails({
    placeId: coverPhotoPlaceId ?? undefined,
    fields: ['photos'],
    enabled: Boolean(coverPhotoPlaceId),
  });
  const firstName = coverDetails?.photos?.[0]?.name ?? null;
  const { url: coverUrl } = usePlacePhotoUrl(firstName, { maxWidthPx: 400 });

  return (
    <View style={{ gap: t.spacing.sm }}>
      {/* Preview */}
      {coverPhotoPlaceId ? (
        <View
          style={{
            height: 120,
            borderRadius: t.radius.lg,
            overflow: 'hidden',
            backgroundColor: t.colors.bgMuted,
          }}
          accessibilityLabel="Current cover photo preview"
        >
          {coverUrl ? (
            <Image
              source={{ uri: coverUrl }}
              style={{ flex: 1 }}
              resizeMode="cover"
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          ) : (
            <View
              style={{ flex: 1, backgroundColor: t.colors.gradientSubtle }}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          )}
        </View>
      ) : (
        <View
          style={{
            height: 80,
            borderRadius: t.radius.lg,
            backgroundColor: t.colors.bgMuted,
            borderWidth: 1,
            borderColor: t.colors.border,
            borderStyle: 'dashed',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            No cover photo set
          </Text>
        </View>
      )}

      {/* Actions */}
      {canEdit ? (
        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={coverPhotoPlaceId ? 'Change cover photo' : 'Set cover photo'}
            onPress={onOpenPicker}
            style={({ pressed }) => [
              {
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                height: 36,
                borderRadius: t.radius.md,
                backgroundColor: pressed ? t.colors.gradientSubtle : t.colors.bgElevated,
                borderWidth: 1,
                borderColor: t.colors.border,
              },
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.primary, fontWeight: '600' }]}>
              {coverPhotoPlaceId ? 'Change' : 'Set cover'}
            </Text>
          </Pressable>
          {coverPhotoPlaceId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove cover photo"
              onPress={onRemove}
              style={({ pressed }) => [
                {
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 36,
                  paddingHorizontal: t.spacing.md,
                  borderRadius: t.radius.md,
                  backgroundColor: pressed ? t.colors.dangerLight : t.colors.bgElevated,
                  borderWidth: 1,
                  borderColor: t.colors.border,
                },
              ]}
            >
              <Text style={[t.typography.caption, { color: t.colors.danger }]}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
