import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DraggableItem, DraggableItineraryProps } from './types';

export function DraggableItinerary({
  items,
  onReorder,
  onLongPress,
  groupLabel,
}: DraggableItineraryProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = useMemo(() => items.map((i) => i.id), [items]);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <View accessibilityLabel={groupLabel} style={styles.root}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <SortableRow key={item.id} item={item} onLongPress={onLongPress} />
          ))}
        </SortableContext>
      </DndContext>
    </View>
  );
}

function SortableRow({
  item,
  onLongPress,
}: {
  item: DraggableItem;
  onLongPress?: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
    userSelect: 'none',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open actions for this place"
        onLongPress={() => onLongPress?.(item.id)}
        delayLongPress={400}
      >
        {item.render(isDragging)}
      </Pressable>
    </div>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
});
