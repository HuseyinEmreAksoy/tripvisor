/**
 * ReactionChip — compact liked/disliked thumb buttons for itinerary place rows.
 *
 * Usage:
 *   <ReactionChip
 *     reaction={currentReaction}        // 'liked' | 'disliked' | null
 *     onChange={(next) => mutate(next)} // null means "remove my rating"
 *   />
 *
 * Two icon buttons sit side-by-side. Active state = filled with day/accent
 * color; inactive = muted background / outline. Tapping the active one
 * calls onChange(null) to toggle-off (unrate).
 *
 * Phase 24 Step 24.3.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import type { TripPlaceReactionType } from '@/api/trip-place-reactions';

export interface ReactionChipProps {
  reaction: TripPlaceReactionType | null;
  onChange: (next: TripPlaceReactionType | null) => void;
  disabled?: boolean;
  /** Optional day-based accent color for the active "liked" state fill. */
  accentColor?: string;
  /**
   * 'sm' = 36px touch targets (itinerary row default).
   * 'lg' = 48px touch targets with text labels (place detail screen).
   */
  size?: 'sm' | 'lg';
}

export function ReactionChip({
  reaction,
  onChange,
  disabled = false,
  accentColor,
  size = 'sm',
}: ReactionChipProps) {
  const t = useTheme();
  const hitSize = size === 'lg' ? 48 : 36;
  const iconFontSize = size === 'lg' ? 20 : 15;
  const likedColor = accentColor ?? t.colors.primary;

  function handlePress(value: TripPlaceReactionType) {
    if (disabled) return;
    // Tapping the active chip toggles it off (null = unrate).
    onChange(reaction === value ? null : value);
  }

  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Rate this place">
      {/* Thumb up */}
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel="Like this place"
        accessibilityState={{ checked: reaction === 'liked', disabled }}
        disabled={disabled}
        onPress={() => handlePress('liked')}
        style={({ pressed }) => [
          styles.btn,
          {
            minWidth: hitSize,
            height: hitSize,
            borderRadius: hitSize / 2,
            backgroundColor: reaction === 'liked' ? likedColor : t.colors.bgMuted,
            borderColor: reaction === 'liked' ? likedColor : t.colors.border,
            opacity: pressed ? 0.7 : disabled ? 0.4 : 1,
            paddingHorizontal: size === 'lg' ? 14 : 8,
          },
        ]}
      >
        <Text
          accessible={false}
          importantForAccessibility="no"
          accessibilityElementsHidden
          style={[styles.icon, { fontSize: iconFontSize }]}
        >
          {'👍'}
        </Text>
        {size === 'lg' ? (
          <Text
            style={[
              t.typography.caption,
              {
                color: reaction === 'liked' ? t.colors.primaryText : t.colors.textMuted,
                marginLeft: 4,
              },
            ]}
          >
            {reaction === 'liked' ? 'Liked' : 'Like'}
          </Text>
        ) : null}
      </Pressable>

      {/* Thumb down */}
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel="Dislike this place"
        accessibilityState={{ checked: reaction === 'disliked', disabled }}
        disabled={disabled}
        onPress={() => handlePress('disliked')}
        style={({ pressed }) => [
          styles.btn,
          {
            minWidth: hitSize,
            height: hitSize,
            borderRadius: hitSize / 2,
            backgroundColor:
              reaction === 'disliked' ? t.colors.danger : t.colors.bgMuted,
            borderColor:
              reaction === 'disliked' ? t.colors.danger : t.colors.border,
            opacity: pressed ? 0.7 : disabled ? 0.4 : 1,
            paddingHorizontal: size === 'lg' ? 14 : 8,
          },
        ]}
      >
        <Text
          accessible={false}
          importantForAccessibility="no"
          accessibilityElementsHidden
          style={[styles.icon, { fontSize: iconFontSize }]}
        >
          {'👎'}
        </Text>
        {size === 'lg' ? (
          <Text
            style={[
              t.typography.caption,
              {
                color: reaction === 'disliked' ? t.colors.primaryText : t.colors.textMuted,
                marginLeft: 4,
              },
            ]}
          >
            {reaction === 'disliked' ? "Didn't like" : "Didn't like"}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  icon: {
    lineHeight: 22,
  },
});
