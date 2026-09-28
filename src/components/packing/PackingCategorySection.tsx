/**
 * PackingCategorySection — one collapsible category on the packing screen
 * (v2 M4 X2.4). The header is a full-width button ("Clothing · 3/5") with
 * `expanded` state; collapsing keeps the progress visible so a finished
 * category can be folded away. A tiny per-category bar mirrors the count.
 */
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { haptics } from '@/lib/haptics';
import type { TripPackingItem } from '@/api';
import type { PackingGroupView } from './packingView';
import { PackingItemRow } from './PackingItemRow';

export interface PackingCategorySectionProps {
  group: PackingGroupView;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  canEdit: boolean;
  onToggleItem: (item: TripPackingItem, checked: boolean) => void;
  onDeleteItem: (item: TripPackingItem) => void;
}

export function PackingCategorySection({
  group,
  collapsed,
  onToggleCollapsed,
  canEdit,
  onToggleItem,
  onDeleteItem,
}: PackingCategorySectionProps) {
  const t = useTheme();
  const done = group.total > 0 && group.packed === group.total;
  const pct = group.total > 0 ? Math.round((group.packed / group.total) * 100) : 0;

  return (
    <View style={{ gap: t.spacing.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${group.title}, ${group.packed} of ${group.total} packed`}
        accessibilityHint={collapsed ? 'Expands this category' : 'Collapses this category'}
        accessibilityState={{ expanded: !collapsed }}
        onPress={() => {
          haptics.select();
          onToggleCollapsed();
        }}
        style={({ pressed }) => [
          styles.header,
          { gap: t.spacing.sm, opacity: pressed ? 0.7 : 1 },
          Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
        ]}
      >
        <View style={{ transform: [{ rotate: collapsed ? '0deg' : '90deg' }] }}>
          <ChevronRight size={18} color={t.colors.textMuted} strokeWidth={2} />
        </View>
        <Text style={[t.typography.subtitle, { color: t.colors.text, flex: 1 }]} accessibilityRole="header" aria-level={3}>
          {group.title}
        </Text>
        <Text style={[t.typography.caption, { color: done ? t.colors.success : t.colors.textMuted, fontWeight: '600' }]}>
          {done ? `✓ ${group.total}` : `${group.packed}/${group.total}`}
        </Text>
      </Pressable>
      <View
        style={[styles.track, { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.pill }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View
          style={[
            styles.track,
            { width: `${pct}%`, backgroundColor: done ? t.colors.success : t.colors.primary, borderRadius: t.radius.pill },
          ]}
        />
      </View>

      {collapsed
        ? null
        : group.visible.map((item) => (
            <PackingItemRow
              key={item.id}
              item={item}
              canEdit={canEdit}
              onToggle={(checked) => onToggleItem(item, checked)}
              onDelete={() => onDeleteItem(item)}
            />
          ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  track: { height: 3, overflow: 'hidden' },
});
