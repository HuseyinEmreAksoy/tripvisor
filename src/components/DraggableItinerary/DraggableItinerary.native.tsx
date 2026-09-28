import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import DraggableFlatList, {
  type RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
import { haptics } from '@/lib/haptics';
import type { DraggableItem, DraggableItineraryProps } from './types';

export function DraggableItinerary({
  items,
  onReorder,
  onLongPress,
  groupLabel,
}: DraggableItineraryProps) {
  const keyExtractor = useMemo(() => (item: DraggableItem) => item.id, []);

  return (
    <View accessibilityLabel={groupLabel} style={styles.root}>
      <DraggableFlatList
        data={items}
        keyExtractor={keyExtractor}
        // v2 M4 X2.3: haptic on pickup and drop (no-op under reduced motion).
        onDragBegin={() => haptics.impact()}
        onDragEnd={({ data }) => {
          haptics.select();
          onReorder(data.map((i) => i.id));
        }}
        renderItem={({ item, drag, isActive }: RenderItemParams<DraggableItem>) => {
          const startDrag = () => {
            drag();
            onLongPress?.(item.id);
          };
          return (
            <ScaleDecorator>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Drag handle. Long-press to open actions.`}
                onLongPress={startDrag}
                delayLongPress={180}
                style={styles.row}
              >
                {item.render(isActive, { onLongPress: startDrag })}
              </Pressable>
            </ScaleDecorator>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  row: {},
});
