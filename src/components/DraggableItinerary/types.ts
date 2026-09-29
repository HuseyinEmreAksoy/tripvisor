/**
 * v2 M4 X2.3: `render` receives the row's gesture handlers so a row whose
 * own full-card Pressable is the innermost touch target (PlaceRow) can
 * carry the long-press itself — an inner Pressable swallows the outer
 * wrapper's long-press on both native and RNW. The second argument is
 * optional to read, so existing renderers keep working unchanged.
 */
export interface DraggableRowGesture {
  /** Native: starts the drag + opens actions. Web: opens actions (dnd-kit drags via pointer). */
  onLongPress: () => void;
}

export interface DraggableItem {
  id: string;
  render: (dragging: boolean, gesture: DraggableRowGesture) => React.ReactNode;
}

export interface DraggableItineraryProps {
  items: DraggableItem[];
  onReorder: (newIds: string[]) => void;
  onLongPress?: (id: string) => void;
  /** Optional label announced to screen readers describing the section (e.g. "Day 1"). */
  groupLabel?: string;
  /**
   * Read-only list (viewers): no drag pickup (native never calls drag(), web
   * uses useSortable({ disabled: true })) and no long-press actions.
   */
  disabled?: boolean;
}
