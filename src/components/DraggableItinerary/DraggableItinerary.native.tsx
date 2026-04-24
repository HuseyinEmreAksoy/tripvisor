import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import DraggableFlatList, {
  type RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
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
        onDragEnd={({ data }) => onReorder(data.map((i) => i.id))}
        renderItem={({ item, drag, isActive }: RenderItemParams<DraggableItem>) => (
          <ScaleDecorator>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Drag handle. Long-press to open actions.`}
              onLongPress={() => {
                drag();
                onLongPress?.(item.id);
              }}
              delayLongPress={180}
              style={styles.row}
            >
              {item.render(isActive)}
            </Pressable>
          </ScaleDecorator>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  row: {},
});
