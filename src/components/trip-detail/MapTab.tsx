/**
 * MapTab — the map tab content for the trip detail route (extracted from
 * app/(app)/trip/[id]/index.tsx in v2 Phase N1 step 1.1 — pure refactor).
 *
 * Composition: render-mode toggle ("Best route" / "My order") + day-filter
 * chips + "From my location" toggle + the platform-split TripMap.
 *
 * Data flow: `places`, `legs`, `trip` come from the route shell. The hooks
 * that v1 already had inside this block are kept here: useUpdateRouteRenderMode
 * (render-mode mutation), useCurrentLocation + useTripUseMyLocation (Step 24.9
 * location toggle — UI/permission state, not server data).
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
// Renamed to TripMap to avoid shadowing the built-in JS Map collection constructor.
// Every `new Map(...)` call in this file must resolve to the built-in; if the
// import were named `Map`, TypeScript/Metro would resolve those call sites to
// the React component and produce a runtime crash ("Cannot read properties of
// undefined (reading 'markers')") on first render.
import { Map as TripMap, decodePolyline, dayColor, type MapMarker, type MapPolyline } from '@/components/Map';
import { useTheme } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { haptics } from '@/lib/haptics';
import {
  useUpdateRouteRenderMode,
  type RouteRenderMode,
  type Trip,
  type TripLeg,
  type TripPlace,
} from '@/api';
import { useCurrentLocation } from '@/hooks/useCurrentLocation';
import { useTripUseMyLocation } from '@/hooks/useTripUseMyLocation';
import { getLocationPermissionState } from './locationPermission';
import { useLocationExplainer } from '@/components/permissions';
import { MapEmptyOverlay } from '@/components/Map/MapEmptyOverlay';
import { useBreakpoint } from '@/hooks/useBreakpoint';

// v2 P1.2: WALK connector steps of a multi-leg transit route render dashed
// in a muted gray (same neutral as dayColor()'s unscheduled fallback) so the
// day-colored TRANSIT segments stay the visual spine of the route.
const WALK_STEP_COLOR = '#8B8B93';

/**
 * v2 P1.2: expand a transit leg's per-step geometry (TripLeg.transit_steps,
 * written by optimize-trip) into one MapPolyline per step:
 *   - TRANSIT steps → solid, day color (no per-vehicle colors — simple)
 *   - WALK steps    → dashed, muted gray
 * Steps without usable geometry are skipped; returns [] when the leg has no
 * steps at all so the caller can fall back to the legacy rendering
 * (solid decoded polyline, or dashed straight line for null polylines).
 */
function transitStepPolylines(leg: TripLeg): MapPolyline[] {
  const steps = leg.transit_steps;
  if (!steps || steps.length === 0) return [];
  const result: MapPolyline[] = [];
  steps.forEach((step, i) => {
    if (!step.polyline) return; // typed nullable for forward-compat
    const points = decodePolyline(step.polyline);
    if (points.length < 2) return;
    const isWalk = step.travelMode === 'WALK';
    result.push({
      id: `${leg.id}:step-${i}`,
      dayIndex: leg.day_index,
      points,
      isDashed: isWalk,
      ...(isWalk ? { strokeColor: WALK_STEP_COLOR } : {}),
    });
  });
  return result;
}

export interface MapTabProps {
  tripId: string;
  places: TripPlace[];
  legs: TripLeg[];
  trip: Trip;
  canEdit: boolean;
  /**
   * Marker tap. v2 M4 X2.2: also receives the trip_places row id so the
   * route can open place detail WITH trip context (reactions need it).
   */
  onMarker: (googlePlaceId: string, tripPlaceId: string) => void;
}

export function MapTab({ tripId, places, legs, trip, canEdit, onMarker }: MapTabProps) {
  const t = useTheme();
  // Desktop split view: the map fills its whole column and the controls float
  // over it as a card, instead of stacking above a short map.
  const isDesktop = useBreakpoint() === 'desktop';

  // ── Route render mode toggle (Step 23.4) ──────────────────────────────────
  const updateRenderMode = useUpdateRouteRenderMode(tripId);
  const currentMode: RouteRenderMode = trip.route_render_mode;

  // ── Phase 24: "From my location" toggle (Step 24.9) ───────────────────────
  const { location: userLocation, status: locationStatus, request: requestLocation } = useCurrentLocation();
  const { enabled: useMyLocation, setEnabled: setUseMyLocation } = useTripUseMyLocation(tripId);
  // v2 M4 X3.2: explain before the OS prompt.
  const locationExplainer = useLocationExplainer({ reason: 'route', onProceed: () => void requestLocation() });

  // ── Day filter state ───────────────────────────────────────────────────────
  // 'all' shows everything; a number filters to that day_index (0-indexed).
  // Resets on tab unmount — per-session, not persisted.
  const [selectedDay, setSelectedDay] = useState<'all' | number>('all');

  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  // All day indexes that have at least one assigned place, deduped and sorted.
  const availableDays = useMemo(() => {
    const seen = new Set<number>();
    for (const p of places) {
      if (p.day_index !== null && p.day_index >= 0) seen.add(p.day_index);
    }
    return [...seen].sort((a, b) => a - b);
  }, [places]);

  // Build the full marker + polyline arrays once.
  const allMarkers: MapMarker[] = useMemo(
    () =>
      places.map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        title: p.user_title ?? 'Place',
        dayIndex: p.day_index,
        orderInDay: p.order_in_day,
      })),
    [places],
  );

  // Phase 20 Step 7 fix: render-time derivation instead of a state-resetting
  // useEffect. The previous design interleaved a useEffect between two
  // useMemo calls, which under React 18 concurrent rendering + Fast Refresh
  // + the parent's auto-optimize cascade caused hook-tape corruption and
  // crashed the entire trip detail route on first cold mount with
  // "Cannot read properties of undefined (reading 'length')" (issue #11).
  //
  // Computing `effectiveSelectedDay` at render time eliminates the
  // state→effect→state cycle. If `selectedDay` no longer points at a valid
  // day (e.g. user deleted all of Day 2's places and returns to the tab),
  // we silently treat it as 'all' for filtering. The setter is still wired
  // to chip taps; if the user taps a chip then deletes its places elsewhere,
  // the filter "softly" falls back to 'all' on next render. Keeping the raw
  // state in `selectedDay` lets the chip's checked-state visually still
  // point at the user's last intent if those places are restored (e.g. via
  // re-optimize) without an extra setState round-trip.
  const effectiveSelectedDay: 'all' | number =
    selectedDay !== 'all' && !availableDays.includes(selectedDay)
      ? 'all'
      : selectedDay;

  // Apply the day filter. When 'all', pass the full arrays (stable references
  // from the memos above so Map doesn't re-render unnecessarily).
  const filteredMarkers = useMemo(() => {
    if (effectiveSelectedDay === 'all') return allMarkers;
    // Exclude unassigned (day_index === null) when filtering by a specific day.
    return allMarkers.filter((m) => m.dayIndex === effectiveSelectedDay);
  }, [allMarkers, effectiveSelectedDay]);

  // ── Transit mode: build dashed polylines for null-polyline legs ──────────
  // Phase 23 Step 23.9: legs with polyline === null become dashed straight
  // lines from the from-place to the to-place using the MapPolyline.isDashed flag.
  const byPlaceId = useMemo(
    () => new Map(places.map((p) => [p.id, p])),
    [places],
  );

  const allPolylinesFull = useMemo(() => {
    const result: MapPolyline[] = [];
    for (const l of legs) {
      if (l.day_index < 0) continue;
      // v2 P1.2: multi-leg transit geometry — one polyline per step (solid
      // day-colored TRANSIT rides, dashed gray WALK connectors). Legs
      // without transit_steps keep the pre-P1 behavior below, exactly.
      const stepLines = transitStepPolylines(l);
      if (stepLines.length > 0) {
        result.push(...stepLines);
        continue;
      }
      if (l.polyline) {
        result.push({
          id: l.id,
          dayIndex: l.day_index,
          points: decodePolyline(l.polyline),
        });
      } else {
        // Transit fallback: straight dashed line.
        const fromPlace = byPlaceId.get(l.from_place_id);
        const toPlace = byPlaceId.get(l.to_place_id);
        if (fromPlace && toPlace) {
          result.push({
            id: l.id,
            dayIndex: l.day_index,
            isDashed: true,
            points: [],
            from: { lat: fromPlace.lat, lng: fromPlace.lng },
            to: { lat: toPlace.lat, lng: toPlace.lng },
          });
        }
      }
    }
    return result;
  }, [legs, byPlaceId]);

  const filteredPolylinesFull = useMemo(() => {
    if (effectiveSelectedDay === 'all') return allPolylinesFull;
    return allPolylinesFull.filter((p) => p.dayIndex === effectiveSelectedDay);
  }, [allPolylinesFull, effectiveSelectedDay]);

  // ── Phase 24 Step 24.9: virtual "from my location" leg ───────────────────
  // When enabled + location granted, prepend a straight-line polyline from
  // the user's position to the first place in the active day. This is
  // render-only and is never written to trip_legs.
  const firstPlaceForActiveDay = useMemo(() => {
    const dayIndex = effectiveSelectedDay === 'all' ? (availableDays[0] ?? null) : effectiveSelectedDay;
    if (dayIndex === null) return null;
    const inDay = places
      .filter((p) => p.day_index === dayIndex)
      .sort((a, b) => (a.order_in_day ?? 0) - (b.order_in_day ?? 0));
    return inDay[0] ?? null;
  }, [places, effectiveSelectedDay, availableDays]);

  const virtualLegPolyline: MapPolyline | null = useMemo(() => {
    if (!useMyLocation || !userLocation || !firstPlaceForActiveDay) return null;
    return {
      id: '__my_location_virtual__',
      dayIndex:
        effectiveSelectedDay === 'all'
          ? (availableDays[0] ?? 0)
          : (effectiveSelectedDay as number),
      isDashed: false,
      points: [],
      from: { lat: userLocation.lat, lng: userLocation.lng },
      to: { lat: firstPlaceForActiveDay.lat, lng: firstPlaceForActiveDay.lng },
    };
  }, [useMyLocation, userLocation, firstPlaceForActiveDay, effectiveSelectedDay, availableDays]);

  const userMarker: MapMarker | null = useMemo(() => {
    if (!useMyLocation || !userLocation) return null;
    return {
      id: '__my_location__',
      lat: userLocation.lat,
      lng: userLocation.lng,
      title: 'My location',
      dayIndex: null,
      orderInDay: null,
    };
  }, [useMyLocation, userLocation]);

  const finalMarkers = useMemo(() => {
    if (!userMarker) return filteredMarkers;
    return [userMarker, ...filteredMarkers];
  }, [filteredMarkers, userMarker]);

  const finalPolylines = useMemo(() => {
    if (!virtualLegPolyline) return filteredPolylinesFull;
    return [virtualLegPolyline, ...filteredPolylinesFull];
  }, [filteredPolylinesFull, virtualLegPolyline]);

  // Handle the toggle button press.
  // v2 M4 X2.2: the button shows "on" only when a fix backs it. A persisted
  // "on" without a fix (permission not yet granted) renders off, and the
  // tap below is the user gesture that asks for permission.
  const locationOn = useMyLocation && Boolean(userLocation);

  async function handleMyLocationToggle() {
    if (locationOn) {
      setUseMyLocation(false);
      return;
    }
    if (locationStatus === 'granted' && userLocation) {
      // Already have permission + location — just enable.
      setUseMyLocation(true);
      return;
    }
    // Need to request permission (via the pre-permission explainer).
    locationExplainer.ask();
    // After request(), `locationStatus` will update asynchronously.
    // We enable the toggle only if granted — checked in the effect below.
  }

  // The toggle state is persisted per trip but the location hook is lazy:
  // when the persisted intent is "on" and we have no fix yet, fetch one so
  // the active button is backed by an actual location (and the virtual leg
  // renders) instead of looking on while doing nothing.
  //
  // v2 M4 X2.2: only when the permission is ALREADY granted. Checking first
  // means a mount never raises an OS/browser prompt without a user gesture;
  // otherwise the button renders "off" until the user taps it.
  useEffect(() => {
    if (!useMyLocation || userLocation || locationStatus !== 'idle') return;
    let cancelled = false;
    void getLocationPermissionState().then((state) => {
      if (!cancelled && state === 'granted') void requestLocation();
    });
    return () => {
      cancelled = true;
    };
  }, [useMyLocation, userLocation, locationStatus, requestLocation]);

  // Enable the toggle automatically once location is granted after a tap.
  useEffect(() => {
    if (locationStatus === 'granted' && !useMyLocation && userLocation) {
      setUseMyLocation(true);
    }
    // Only fire when status flips to 'granted'; ignore other transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationStatus]);

  return (
    <View style={{ flex: 1 }}>
      <View
        pointerEvents="box-none"
        style={
          isDesktop
            ? [
                styles.overlayPanel,
                {
                  top: t.spacing.md,
                  left: t.spacing.md,
                  backgroundColor: t.colors.cardBgSolid,
                  borderRadius: t.radius.lg,
                  borderColor: t.colors.border,
                  paddingTop: t.spacing.sm,
                  ...t.shadows.md(t.colors.shadowColor),
                },
              ]
            : undefined
        }
      >
      {/* ── Route render mode segmented control (Step 23.4) ──────────────────
       * When places.length === 0, the control sits inside the empty-state card
       * with descriptive copy. When places exist, it's a persistent toggle
       * above the day chip row. Owners + editors get the live control; viewers
       * see it read-only (taps are no-ops with a visual-only display).
       */}
      {places.length === 0 ? (
        <View
          style={
            isDesktop
              ? { paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.sm, gap: t.spacing.sm }
              : {
                  margin: t.spacing.lg,
                  padding: t.spacing.md,
                  backgroundColor: t.colors.bgElevated,
                  borderRadius: t.radius.lg,
                  borderWidth: 1,
                  borderColor: t.colors.border,
                  gap: t.spacing.sm,
                }
          }
        >
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            {trip.transport_mode === 'transit'
              ? 'Transit mode: routes will use realistic times; tap each leg to view step-by-step on Google Maps'
              : 'Add places, then choose how to draw the route.'}
          </Text>
          <RouteRenderModeControl
            mode={currentMode}
            pending={updateRenderMode.isPending}
            canEdit={canEdit}
            onSelect={(m) => updateRenderMode.mutate(m)}
          />
        </View>
      ) : (
        <View style={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm }}>
          <RouteRenderModeControl
            mode={currentMode}
            pending={updateRenderMode.isPending}
            canEdit={canEdit}
            onSelect={(m) => updateRenderMode.mutate(m)}
          />
        </View>
      )}

      {/* Chip row — only rendered once at least one place has been assigned to a day */}
      {availableDays.length > 0 ? (
        <View
          style={{
            paddingHorizontal: t.spacing.lg,
            paddingVertical: t.spacing.sm,
          }}
        >
          {/*
           * accessibilityRole="radiogroup" on the wrapping View groups all chips
           * for screen readers; each chip carries role="radio" + checked state.
           */}
          <View accessibilityRole="radiogroup" accessibilityLabel="Filter map by day">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: t.spacing.sm }}
            >
              {/* "All" chip */}
              {(['all', ...availableDays] as Array<'all' | number>).map((value) => {
                const isAll = value === 'all';
                const isSelected = effectiveSelectedDay === value;
                const label = isAll ? 'All' : `Day ${(value as number) + 1}`;
                const dotColor = isAll ? undefined : dayColor(value as number);

                return (
                  <Pressable
                    key={String(value)}
                    accessibilityRole="radio"
                    accessibilityLabel={label}
                    accessibilityState={{ checked: isSelected }}
                    onPress={() => setSelectedDay(value)}
                    style={[
                      styles.dayChip,
                      {
                        backgroundColor: isSelected
                          ? t.colors.primary
                          : t.colors.bgElevated,
                        borderColor: isSelected ? t.colors.primary : t.colors.border,
                        borderRadius: t.radius.md,
                      },
                    ]}
                  >
                    {/* Color dot for day chips — kept compact (8×8) so it doesn't compete with the label */}
                    {!isAll && dotColor ? (
                      <View
                        style={[
                          styles.dayChipDot,
                          { backgroundColor: dotColor },
                        ]}
                        // Purely decorative; the label already conveys identity.
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    ) : null}
                    <Text
                      style={[
                        t.typography.caption,
                        {
                          color: isSelected ? t.colors.primaryText : t.colors.text,
                          fontWeight: isSelected ? '600' : '400',
                        },
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      ) : null}

      {/* ── Phase 24 Step 24.9: "From my location" toggle ─────────────────
       * Hidden only when locationStatus === 'unavailable' (no geolocation
       * capability at all). Spinner while requesting; inline retry row on
       * denied and on transient errors (timeout / no fix).
       */}
      {locationStatus !== 'unavailable' ? (
        <View style={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.sm, gap: t.spacing.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={locationOn ? 'Disable route from my location' : 'Route from my location'}
            accessibilityState={{ selected: locationOn }}
            onPress={handleMyLocationToggle}
            style={({ pressed }) => [
              styles.myLocationBtn,
              {
                backgroundColor: locationOn ? t.colors.primary : t.colors.bgElevated,
                borderColor: locationOn ? t.colors.primary : t.colors.border,
                opacity: pressed ? 0.75 : 1,
                borderRadius: t.radius.md,
              },
            ]}
          >
            {locationStatus === 'requesting' ? (
              <ActivityIndicator
                size="small"
                color={locationOn ? t.colors.primaryText : t.colors.primary}
              />
            ) : (
              <Icon
                name="locate-fixed"
                size={16}
                color={locationOn ? t.colors.primaryText : t.colors.textMuted}
              />
            )}
            <Text
              style={[
                t.typography.caption,
                {
                  color: locationOn ? t.colors.primaryText : t.colors.text,
                  fontWeight: locationOn ? '600' : '400',
                },
              ]}
            >
              {locationOn ? 'From my location' : 'From my location'}
            </Text>
          </Pressable>

          {locationStatus === 'denied' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Text
                style={[t.typography.caption, { color: t.colors.danger, flex: 1 }]}
                accessibilityLiveRegion="polite"
              >
                {'Location permission denied — enable in browser/system settings.'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try requesting location again"
                // Retry directly — the toggle would switch a persisted "on" off.
                onPress={() => {
                  void requestLocation();
                }}
              >
                <Text style={[t.typography.caption, { color: t.colors.primaryInk }]}>
                  {'Try again'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {locationStatus === 'error' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Text
                style={[t.typography.caption, { color: t.colors.danger, flex: 1 }]}
                accessibilityLiveRegion="polite"
              >
                {"Couldn't get your location — check location services and try again."}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry getting my location"
                onPress={() => {
                  void requestLocation();
                }}
              >
                <Text style={[t.typography.caption, { color: t.colors.primaryInk }]}>
                  {'Retry'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      </View>

      {/* Map fills the remaining space (the whole column on desktop) */}
      <View style={[{ flex: 1 }, isDesktop && styles.desktopMap]}>
        <TripMap
          markers={finalMarkers}
          polylines={finalPolylines}
          onMarkerPress={(markerId: string) => {
            if (markerId === '__my_location__') return; // user marker — no action
            const p = byId.get(markerId);
            if (p) onMarker(p.google_place_id, p.id);
          }}
        />
        {places.length === 0 ? <MapEmptyOverlay placement={isDesktop ? 'bottom' : 'center'} /> : null}
      </View>
      {locationExplainer.sheet}
    </View>
  );
}

// ── RouteRenderModeControl ──────────────────────────────────────────────────
//
// Small inline segmented control for the "Best route" / "My order" toggle.
// Uses the same chip aesthetic as the day filter chips above the map.
// When `pending` is true (optimize in-flight) the inactive option shows
// a visual disabled state; the active option's label shows "…".
// When `canEdit` is false the control is display-only (no press handler).

function RouteRenderModeControl({
  mode,
  pending,
  canEdit,
  onSelect,
}: {
  mode: RouteRenderMode;
  pending: boolean;
  canEdit: boolean;
  onSelect: (m: RouteRenderMode) => void;
}) {
  const t = useTheme();

  const options: Array<{ value: RouteRenderMode; label: string; icon: IconName }> = [
    { value: 'optimized', label: 'Best route', icon: 'route' },
    { value: 'manual', label: 'My order', icon: 'list-ordered' },
  ];

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Route rendering mode"
      style={styles.renderModeRow}
    >
      {options.map((opt) => {
        const isActive = mode === opt.value;
        const isDisabled = pending && !isActive;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="radio"
            accessibilityLabel={
              pending && isActive
                ? `${opt.label}, applying…`
                : opt.label
            }
            accessibilityState={{ checked: isActive, disabled: isDisabled || !canEdit }}
            onPress={
              canEdit && !pending
                ? () => {
                    if (!isActive) haptics.select();
                    onSelect(opt.value);
                  }
                : undefined
            }
            style={[
              styles.renderModeChip,
              {
                backgroundColor: isActive ? t.colors.primary : t.colors.bgElevated,
                borderColor: isActive ? t.colors.primary : t.colors.border,
                borderRadius: t.radius.md,
                opacity: isDisabled ? 0.45 : 1,
              },
            ]}
          >
            <Icon
              name={opt.icon}
              size={15}
              color={isActive ? t.colors.primaryText : t.colors.textMuted}
            />
            <Text
              style={[
                t.typography.caption,
                {
                  color: isActive ? t.colors.primaryText : t.colors.text,
                  fontWeight: isActive ? '600' : '400',
                },
              ]}
            >
              {pending && isActive ? 'Applying…' : opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Desktop: floating controls card over the map (top-left).
  overlayPanel: {
    position: 'absolute',
    zIndex: 2,
    maxWidth: 420,
    borderWidth: 1,
  },
  desktopMap: {
    minHeight: 420,
  },
  // Day-filter chips rendered above the Map in MapTab.
  dayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12, // t.spacing.md = 12
    minHeight: 44,
    gap: 6,
  },
  dayChipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  // "From my location" toggle button (Step 24.9)
  myLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
    gap: 6,
    alignSelf: 'flex-start',
  },
  // Route render mode segmented control (Step 23.4)
  renderModeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  renderModeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
    gap: 6,
    flex: 1,
    justifyContent: 'center',
  },
});
