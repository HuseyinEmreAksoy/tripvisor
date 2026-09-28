/**
 * Location pre-permission explainer (v2 M4 X3.2).
 *
 * The OS / browser location prompt is one-shot on iOS and easy to deny by
 * reflex everywhere, so we explain first, in our own words, and only raise
 * the real prompt after the user taps "Continue".
 *
 *   const explainer = useLocationExplainer({ reason: 'distance', onProceed: request });
 *   <Button onPress={explainer.ask} />
 *   {explainer.sheet}
 *
 * `ask()` skips the explainer when permission is already granted (nothing to
 * ask) or permanently denied (the OS won't prompt again; `onProceed` runs so
 * the caller's own "denied" state shows). When the platform can't report the
 * state (Safari < 16), the explainer shows once per app session.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { getLocationPermissionState } from '@/components/trip-detail/locationPermission';
import { useTheme } from '@/theme';

export type LocationReason = 'distance' | 'route';

const COPY: Record<LocationReason, { title: string; body: string }> = {
  distance: {
    title: 'See how far your next stop is',
    body: 'Tripvisor checks where you are once, right now, to estimate how long it takes to reach your next stop.',
  },
  route: {
    title: 'Start the route from where you are',
    body: 'Tripvisor uses your current position to draw a line from you to the first stop of the day on the map.',
  },
};

let explainedUnknownThisSession = false;

/** Test hook: reset the once-per-session memory. */
export function __resetLocationExplainerSession(): void {
  explainedUnknownThisSession = false;
}

export interface LocationExplainerSheetProps {
  visible: boolean;
  reason: LocationReason;
  onContinue: () => void;
  onClose: () => void;
}

export function LocationExplainerSheet({ visible, reason, onContinue, onClose }: LocationExplainerSheetProps) {
  const t = useTheme();
  const copy = COPY[reason];
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel="Location access">
      <View style={[styles.body, { gap: t.spacing.md, padding: t.spacing.xs }]}>
        <View
          style={[styles.iconTile, { backgroundColor: t.colors.gradientSubtle, borderRadius: t.radius.pill }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <Icon name="map-pin" size={26} color={t.colors.primary} />
        </View>
        <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header">
          {copy.title}
        </Text>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>{copy.body}</Text>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          Your location stays on this device. It isn’t saved to your account or shared with anyone.
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          Your phone or browser will ask for permission next. You can change it any time in its settings.
        </Text>
        <View style={{ gap: t.spacing.sm, marginTop: t.spacing.xs }}>
          <Button label="Continue" onPress={onContinue} accessibilityHint="Shows the system location permission prompt" />
          <Button variant="ghost" label="Not now" onPress={onClose} />
        </View>
      </View>
    </BottomSheet>
  );
}

export interface UseLocationExplainerOptions {
  reason: LocationReason;
  /** Runs the real permission request (e.g. useCurrentLocation().request). */
  onProceed: () => void;
}

export interface LocationExplainer {
  ask: () => void;
  sheet: React.ReactNode;
}

export function useLocationExplainer({ reason, onProceed }: UseLocationExplainerOptions): LocationExplainer {
  const [open, setOpen] = useState(false);
  const proceedRef = useRef(onProceed);
  useEffect(() => {
    proceedRef.current = onProceed;
  }, [onProceed]);

  const ask = useCallback(() => {
    void getLocationPermissionState().then((state) => {
      if (state === 'granted' || state === 'denied') {
        proceedRef.current();
        return;
      }
      if (state === 'unknown' && explainedUnknownThisSession) {
        proceedRef.current();
        return;
      }
      setOpen(true);
    });
  }, []);

  const onContinue = useCallback(() => {
    explainedUnknownThisSession = true;
    setOpen(false);
    proceedRef.current();
  }, []);

  const onClose = useCallback(() => setOpen(false), []);

  // Mounted only while open: host screens (cards, map) pay nothing until the
  // user actually asks for location.
  const sheet = open ? (
    <LocationExplainerSheet visible reason={reason} onContinue={onContinue} onClose={onClose} />
  ) : null;
  return { ask, sheet };
}

const styles = StyleSheet.create({
  body: { alignItems: 'stretch' },
  iconTile: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
});
