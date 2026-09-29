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
import { haptics } from '@/lib/haptics';
import type { DraggableItem, DraggableItineraryProps } from './types';

export function DraggableItinerary({
  items,
  onReorder,
  onLongPress,
  groupLabel,
  disabled = false,
}: DraggableItineraryProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = useMemo(() => items.map((i) => i.id), [items]);

  // v2 M4 X2.3: pickup/drop haptics — a no-op on web today (haptics.ts),
  // kept symmetrical with native so the behavior lives in one place.
  const handleDragEnd = (e: DragEndEvent) => {
    haptics.select();
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <View accessibilityLabel={groupLabel} style={styles.root}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => haptics.impact()}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <SortableRow
              key={item.id}
              item={item}
              onLongPress={disabled ? undefined : onLongPress}
              disabled={disabled}
            />
          ))}
        </SortableContext>
      </DndContext>
    </View>
  );
}

function SortableRow({
  item,
  onLongPress,
  disabled = false,
}: {
  item: DraggableItem;
  onLongPress?: (id: string) => void;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: disabled ? 'default' : 'grab',
    userSelect: 'none',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {/* v2 S2.8.13: pure gesture surface, NOT an accessibility node. Its
          old accessibilityRole="button" rendered a <button> wrapping the
          row card's own <button> — invalid HTML (the baseline "<button>
          cannot be a descendant of <button>" console error) and a fake
          affordance anyway: it only answered long-press, which mouse and
          keyboard users don't have (F4). The accessible path to actions is
          the row's web kebab (PlaceRow, label "Place actions"); keyboard
          drag stays on the outer div via dnd-kit's sortable attributes.
          Long-press is kept for touch-web parity with native. */}
      <Pressable
        accessible={false}
        focusable={false}
        onLongPress={() => onLongPress?.(item.id)}
        delayLongPress={400}
      >
        {item.render(isDragging, { onLongPress: () => onLongPress?.(item.id) })}
      </Pressable>
    </div>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
});
