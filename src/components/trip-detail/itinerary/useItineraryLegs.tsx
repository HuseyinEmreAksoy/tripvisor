/**
 * useItineraryLegs — everything ItineraryTab needs for per-leg modes
 * (M5 Y3.3), so the tab itself only mounts the pieces:
 *   - `legChipFor(...)` → PlaceRow's `legChip` prop (null for Ideas rows,
 *     where there are no legs; the chip is only ever drawn AFTER a stop, so
 *     never before a day's first stop);
 *   - `dayModeControl(dayIndex)` → the day-header default-mode chip;
 *   - `keptReason(dayIndex)` → 'flight' | 'ferry' when the optimizer keeps
 *     that day's order (optimized mode), else null;
 *   - `sheet` → the one LegModeSheet instance, mounted once by the tab.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { ActionErrorBanner } from '../ActionErrorBanner';
import type { Trip, TripDay, TripLeg, TripPlace, TransportMode } from '@/api/types';
import { buildLegChipModel, keptOrderDays, type LegChipModel } from './legModes';
import { LegModeSheet } from './LegModeSheet';
import { DayModeControl } from './DayModeControl';
import { useLegModeActions } from './useLegModeActions';

interface OpenLeg {
  fromId: string;
  toId: string;
  dayIndex: number;
}

export function useItineraryLegs({
  trip,
  places,
  dayRecords,
  canEdit,
  online,
  untitled,
}: {
  trip: Trip;
  places: TripPlace[];
  dayRecords: ReadonlyMap<number, TripDay>;
  canEdit: boolean;
  online: boolean;
  /** Fallback place title ("Untitled place"). */
  untitled: string;
}) {
  const actions = useLegModeActions(trip, online);
  const { t: tx } = useT('routes');
  // Keys stay in state; the text is resolved at render (language switches).
  const errorText =
    actions.errorKey === 'errors.saveFailed'
      ? tx('errors.saveFailed')
      : actions.errorKey === 'errors.dayOffline'
        ? tx('errors.dayOffline')
        : actions.errorKey === 'errors.recomputeFailed'
          ? tx('errors.recomputeFailed')
          : null;
  const [open, setOpen] = useState<OpenLeg | null>(null);
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const kept = useMemo(
    () => keptOrderDays(places, trip.route_render_mode),
    [places, trip.route_render_mode],
  );

  const dayModeOf = useCallback(
    (dayIndex: number): TransportMode | null => dayRecords.get(dayIndex)?.transport_mode ?? null,
    [dayRecords],
  );

  const legChipFor = (
    dayIndex: number,
    place: TripPlace,
    next: TripPlace | undefined,
    leg: TripLeg | undefined,
  ): { model: LegChipModel; onEdit?: () => void } | null => {
    if (dayIndex < 0 || !next) return null;
    return {
      model: buildLegChipModel({
        leg,
        toPlace: next,
        dayMode: dayModeOf(dayIndex),
        tripMode: trip.transport_mode,
      }),
      onEdit: canEdit
        ? () => {
            actions.clearError();
            setOpen({ fromId: place.id, toId: next.id, dayIndex });
          }
        : undefined,
    };
  };

  const dayModeControl = (dayIndex: number): ReactNode =>
    dayIndex < 0 ? null : (
      <DayModeControl
        dayNumber={dayIndex + 1}
        dayMode={dayModeOf(dayIndex)}
        tripMode={trip.transport_mode}
        canEdit={canEdit}
        online={online}
        onChange={(mode) => actions.setDayMode(dayIndex, mode)}
        saving={actions.saving}
        errorText={errorText}
      />
    );

  const from = open ? byId.get(open.fromId) : undefined;
  const to = open ? byId.get(open.toId) : undefined;
  const sheet =
    canEdit && open ? (
      <LegModeSheet
        visible={Boolean(from && to)}
        onClose={() => setOpen(null)}
        fromTitle={from?.user_title ?? untitled}
        toTitle={to?.user_title ?? untitled}
        currentMode={to?.arrival_mode ?? null}
        currentMinutes={to?.arrival_minutes ?? null}
        inheritedMode={dayModeOf(open.dayIndex) ?? trip.transport_mode}
        scheduled={open.dayIndex >= 0 && (to?.day_index ?? -1) >= 0}
        onSave={(mode, minutes) => actions.setLegMode(open.toId, mode, minutes)}
        saving={actions.saving}
        errorText={errorText}
      />
    ) : null;

  // A recompute that fails after the sheet closed surfaces above the list.
  const banner =
    actions.errorKey === 'errors.recomputeFailed' && !open ? (
      <ActionErrorBanner message={errorText} onDismiss={actions.clearError} />
    ) : null;

  return {
    legChipFor,
    dayModeControl,
    keptReason: (dayIndex: number) => kept.get(dayIndex) ?? null,
    sheet,
    banner,
    recomputing: actions.recomputing,
  };
}
