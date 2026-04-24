export interface DraggableItem {
  id: string;
  render: (dragging: boolean) => React.ReactNode;
}

export interface DraggableItineraryProps {
  items: DraggableItem[];
  onReorder: (newIds: string[]) => void;
  onLongPress?: (id: string) => void;
  /** Optional label announced to screen readers describing the section (e.g. "Day 1"). */
  groupLabel?: string;
}
