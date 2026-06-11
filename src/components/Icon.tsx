/**
 * Icon — functional line icons (v3 design-system refresh).
 *
 * Renders a Lucide line icon (1.75px stroke, theme-colored) for FUNCTIONAL
 * spots — navigation, controls, metadata. Emoji remain the expressive layer
 * (✈️ countdowns, ✨ AI moments, empty states, category emoji) and are NOT
 * routed through this component.
 *
 * Per the design handoff (`tripvisor-design-system/components/icons`):
 * core vocabulary only, statically imported so the bundle stays tree-shaken.
 * `lucide-react-native` renders via react-native-svg (already a dependency) —
 * identical output on iOS / Android / Web.
 *
 *   <Icon name="chevron-left" size={22} label="Back" />
 *   <Icon name="message-circle" color={t.colors.textMuted} />
 */
import React from 'react';
import {
  AlarmClock,
  Bike,
  Calendar,
  Car,
  ChevronLeft,
  ChevronRight,
  Clock,
  EllipsisVertical,
  FileText,
  Footprints,
  Luggage,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  Pencil,
  Plus,
  Printer,
  Search,
  Settings,
  Share2,
  TrainFront,
  Users,
  Wallet,
  X,
} from 'lucide-react-native';
import { useTheme } from '@/theme';

const REGISTRY = {
  'alarm-clock': AlarmClock,
  bike: Bike,
  calendar: Calendar,
  car: Car,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  clock: Clock,
  'ellipsis-vertical': EllipsisVertical,
  'file-text': FileText,
  footprints: Footprints,
  luggage: Luggage,
  map: MapIcon,
  'map-pin': MapPin,
  'message-circle': MessageCircle,
  pencil: Pencil,
  plus: Plus,
  printer: Printer,
  search: Search,
  settings: Settings,
  'share-2': Share2,
  'train-front': TrainFront,
  users: Users,
  wallet: Wallet,
  x: X,
} as const;

export type IconName = keyof typeof REGISTRY;

export interface IconProps {
  name: IconName;
  /** Square size in px. Default 20. */
  size?: number;
  /** Stroke/line color. Defaults to the theme text color. */
  color?: string;
  /** Lucide line weight — the brand stroke is 1.75. */
  strokeWidth?: number;
  /**
   * Accessibility label. When omitted the icon is decorative and hidden from
   * the a11y tree (the adjacent text label carries the meaning).
   */
  label?: string;
}

export function Icon({ name, size = 20, color, strokeWidth = 1.75, label }: IconProps) {
  const t = useTheme();
  const Glyph = REGISTRY[name];
  return (
    <Glyph
      size={size}
      color={color ?? t.colors.text}
      strokeWidth={strokeWidth}
      accessibilityLabel={label}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
      aria-hidden={!label}
    />
  );
}
