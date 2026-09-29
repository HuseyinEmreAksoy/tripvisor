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
import { Platform } from 'react-native';
import {
  AlarmClock,
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Bike,
  Calendar,
  Car,
  ChartColumn,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clock,
  Compass,
  Delete,
  Download,
  EllipsisVertical,
  ExternalLink,
  FileText,
  Footprints,
  Globe,
  Hourglass,
  Image as ImageIcon,
  Lock,
  ListOrdered,
  LocateFixed,
  Luggage,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Printer,
  Route,
  Search,
  Settings,
  Share2,
  Sparkles,
  Star,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Timer,
  TrainFront,
  TriangleAlert,
  Upload,
  Users,
  Wallet,
  X,
  CircleCheck,
  Eraser,
  LogOut,
  Mail,
  Moon,
  Plane,
  SunMoon,
  Trash2,
} from 'lucide-react-native';
import { useTheme } from '@/theme';

const REGISTRY = {
  'alarm-clock': AlarmClock,
  'alert-triangle': TriangleAlert,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  bed: BedDouble,
  bike: Bike,
  calendar: Calendar,
  car: Car,
  'chart-column': ChartColumn,
  check: Check,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'circle-user': CircleUserRound,
  clock: Clock,
  compass: Compass,
  delete: Delete,
  download: Download,
  'ellipsis-vertical': EllipsisVertical,
  'external-link': ExternalLink,
  'file-text': FileText,
  footprints: Footprints,
  globe: Globe,
  hourglass: Hourglass,
  image: ImageIcon,
  lock: Lock,
  'list-ordered': ListOrdered,
  'locate-fixed': LocateFixed,
  luggage: Luggage,
  'map-pin': MapPin,
  map: MapIcon,
  'message-circle': MessageCircle,
  paperclip: Paperclip,
  pencil: Pencil,
  pin: Pin,
  plus: Plus,
  printer: Printer,
  route: Route,
  search: Search,
  settings: Settings,
  'share-2': Share2,
  sparkles: Sparkles,
  star: Star,
  sun: Sun,
  'thumbs-down': ThumbsDown,
  'thumbs-up': ThumbsUp,
  timer: Timer,
  'train-front': TrainFront,
  upload: Upload,
  users: Users,
  wallet: Wallet,
  x: X,
  'circle-check': CircleCheck,
  eraser: Eraser,
  'log-out': LogOut,
  mail: Mail,
  moon: Moon,
  plane: Plane,
  'sun-moon': SunMoon,
  trash: Trash2,
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

/**
 * On web react-native-svg spreads unknown props straight onto the DOM <svg>,
 * so RN-only a11y props (accessibilityLabel / accessibilityElementsHidden /
 * importantForAccessibility) trigger React "unknown prop" warnings. Web gets
 * ARIA attributes; native keeps the RN props.
 */
function a11yProps(label: string | undefined): Record<string, unknown> {
  if (Platform.OS === 'web') {
    return label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: 'false' };
  }
  return {
    accessibilityLabel: label,
    accessibilityElementsHidden: !label,
    importantForAccessibility: label ? 'yes' : 'no-hide-descendants',
  };
}

export function Icon({ name, size = 20, color, strokeWidth = 1.75, label }: IconProps) {
  const t = useTheme();
  const Glyph = REGISTRY[name];
  return (
    <Glyph
      size={size}
      color={color ?? t.colors.text}
      strokeWidth={strokeWidth}
      {...a11yProps(label)}
    />
  );
}
