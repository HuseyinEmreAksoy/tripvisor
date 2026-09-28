/**
 * AssistMenu — one "✨ Assist" button that folds the itinerary's AI tools
 * (AI edit, import a list, fill free time) into a single menu sheet
 * (v2 M4 X2.3). Replaces the separate header/Ideas tool chips so the
 * phone's top bar spends its width on the day strip.
 *
 * Every item only OPENS an existing sheet (AiEditSheet, ImportPlacesSheet,
 * GapFillSheet) — those keep their preview-before-apply + undo contracts.
 */
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { BottomSheet } from '@/components/BottomSheet';
import { Icon, type IconName } from '@/components/Icon';
import { haptics } from '@/lib/haptics';

const IOS_MODAL_HANDOFF_MS = 350;

export interface AssistItem {
  key: string;
  title: string;
  description: string;
  onPress: () => void;
  /** Leading line icon (X3.1 — replaces the emoji title prefixes). */
  icon?: IconName;
  /** Disabled items stay visible with their description explaining why. */
  disabled?: boolean;
}

export interface AssistMenuProps {
  items: AssistItem[];
}

export function AssistMenu({ items }: AssistMenuProps) {
  const t = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Assist: edit with AI, import places, or fill free time"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          haptics.tap();
          setOpen(true);
        }}
        hitSlop={{ top: 4, bottom: 4 }}
        style={({ pressed }) => [
          styles.trigger,
          {
            borderRadius: t.radius.pill,
            borderColor: t.colors.primary,
            backgroundColor: t.colors.gradientSubtle,
            paddingHorizontal: t.spacing.md,
            marginLeft: t.spacing.xs,
            opacity: pressed ? 0.7 : 1,
          },
          Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
        ]}
      >
        <Text style={[t.typography.small, { color: t.colors.primaryInk, fontWeight: '700' }]}>
          ✨ Assist
        </Text>
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)} accessibilityLabel="Assist menu">
        <Text accessibilityRole="header" style={[t.typography.subtitle, { color: t.colors.text }]}>
          Assist
        </Text>
        <View style={{ gap: t.spacing.xs }}>
          {items.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${item.description}`}
              accessibilityState={{ disabled: Boolean(item.disabled) }}
              disabled={item.disabled}
              onPress={() => {
                setOpen(false);
                // iOS can't present a Modal while another is still
                // dismissing — let this sheet's slide-out finish first.
                if (Platform.OS === 'ios') setTimeout(item.onPress, IOS_MODAL_HANDOFF_MS);
                else item.onPress();
              }}
              style={({ pressed }) => [
                styles.item,
                {
                  borderRadius: t.radius.md,
                  paddingHorizontal: t.spacing.md,
                  paddingVertical: t.spacing.sm,
                  backgroundColor: pressed ? t.colors.bgMuted : t.colors.bgElevated,
                  opacity: item.disabled ? 0.5 : 1,
                },
                Platform.OS === 'web' && !item.disabled && ({ cursor: 'pointer' } as ViewStyle),
              ]}
            >
              {item.icon ? (
                <View style={[styles.itemIcon, { backgroundColor: t.colors.gradientSubtle, borderRadius: t.radius.pill }]}>
                  <Icon name={item.icon} size={18} color={t.colors.primary} />
                </View>
              ) : null}
              <View style={styles.itemText}>
                <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>{item.title}</Text>
                <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{item.description}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 36, // + 4pt hitSlop top/bottom = 44pt target
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  itemText: { flex: 1, gap: 2 },
});
