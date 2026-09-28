/**
 * AccommodationCard — single accommodation row in the list.
 *
 * v2 M4 X2.4 layout (usable in 1–2 taps mid-trip):
 *   - Name + "N nights" pill (+ "Day X → Day Y" bridge when the trip has dates)
 *   - Check-in / Check-out columns ("Sun 10 May")
 *   - Address (or "Google Place" chip) with a Navigate button that opens the
 *     device maps app via `buildDirectionsUrl` (coords) or the address query
 *   - Copyable confirmation code (parsed from notes — see stayUtils)
 *   - Inline notes editor (Phase 25 Step 25.10), minus the confirmation line
 *   - Edit + delete, gated by canEdit; delete confirm via `confirmDestructive`
 *
 * The container is NOT `accessible` (that would swallow the buttons for
 * VoiceOver); the header block carries the summary label instead.
 * Props are unchanged from v1 — X2.1/X2.2 mount this card as-is.
 */
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { haptics } from '@/lib/haptics';
import { Icon } from '@/components/Icon';
import { copyToClipboard } from '@/lib/clipboard';
import { confirmDestructive } from '@/lib/confirm';
import type { TripAccommodation } from '@/api/types';
import { AccommodationNotesEditor } from './AccommodationNotesEditor';
import {
  extractConfirmationCode,
  formatStayDate,
  nightsBetween,
  nightsLabel,
  stayDirectionsUrl,
} from './stayUtils';

export interface AccommodationCardProps {
  accommodation: TripAccommodation;
  tripStartDate: string | null;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export function AccommodationCard({
  accommodation,
  tripStartDate,
  canEdit,
  onEdit,
  onDelete,
}: AccommodationCardProps) {
  const t = useTheme();

  const dayBridge = computeDayBridge(accommodation, tripStartDate);
  const nights = nightsBetween(accommodation.check_in_date, accommodation.check_out_date);
  const checkIn = formatStayDate(accommodation.check_in_date);
  const checkOut = formatStayDate(accommodation.check_out_date);
  const directionsUrl = stayDirectionsUrl(accommodation);
  const code = extractConfirmationCode(accommodation.notes);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.colors.bgElevated,
          borderColor: t.colors.border,
          borderRadius: t.radius.md,
          padding: t.spacing.md,
          gap: t.spacing.sm,
          ...t.shadows.sm(t.colors.shadowColor),
        },
      ]}
    >
      {/* Header: name + nights / day bridge + check-in/out */}
      <View
        accessible
        accessibilityLabel={`${accommodation.name}, check-in ${checkIn}, check-out ${checkOut}${nights > 0 ? `, ${nightsLabel(nights)}` : ''}`}
        style={{ gap: t.spacing.sm }}
      >
        <View style={[styles.row, { justifyContent: 'space-between', gap: t.spacing.sm }]}>
          <Text style={[t.typography.bodyStrong, { color: t.colors.text, flex: 1 }]} numberOfLines={1}>
            {accommodation.name}
          </Text>
          <View style={[styles.row, { gap: t.spacing.xs }]}>
            {nights > 0 ? <Pill text={nightsLabel(nights)} /> : null}
            {dayBridge ? <Pill text={dayBridge} subtle /> : null}
          </View>
        </View>

        <View style={[styles.row, { gap: t.spacing.lg }]}>
          <DateColumn label="Check-in" value={checkIn} />
          <Icon name="arrow-right" size={18} color={t.colors.textMuted} />
          <DateColumn label="Check-out" value={checkOut} />
        </View>
      </View>

      {/* Address / place + Navigate */}
      {accommodation.address || accommodation.google_place_id || directionsUrl ? (
        <View style={[styles.row, { gap: t.spacing.sm }]}>
          <View style={{ flex: 1 }}>
            {accommodation.address ? (
              <Text style={[t.typography.caption, { color: t.colors.textMuted }]} numberOfLines={2}>
                {accommodation.address}
              </Text>
            ) : accommodation.google_place_id ? (
              <View
                style={[
                  styles.pill,
                  {
                    backgroundColor: t.colors.infoLight,
                    borderRadius: t.radius.pill,
                    paddingHorizontal: t.spacing.sm,
                    alignSelf: 'flex-start',
                  },
                ]}
              >
                <Text style={[t.typography.small, { color: t.colors.info }]}>Google Place</Text>
              </View>
            ) : null}
          </View>
          {directionsUrl ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Navigate to ${accommodation.name}`}
              accessibilityHint="Opens directions in your maps app"
              onPress={() => {
                haptics.tap();
                void Linking.openURL(directionsUrl).catch(() => undefined);
              }}
              style={({ pressed }) => [
                styles.navBtn,
                {
                  backgroundColor: pressed ? t.colors.primaryDark : t.colors.primary,
                  borderRadius: t.radius.pill,
                  paddingHorizontal: t.spacing.md,
                },
                Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
              ]}
            >
              <Text style={[t.typography.caption, { color: t.colors.primaryText, fontWeight: '700' }]}>
                Navigate
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {code ? <ConfirmationCode code={code} /> : null}

      <AccommodationNotesEditor accommodation={accommodation} canEdit={canEdit} />

      {/* Actions */}
      {canEdit ? (
        <View style={[styles.row, { gap: t.spacing.sm, justifyContent: 'flex-end' }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit accommodation: ${accommodation.name}`}
            onPress={onEdit}
            style={({ pressed }) => [
              styles.actionBtn,
              {
                backgroundColor: pressed ? t.colors.gradientSubtle : 'transparent',
                borderRadius: t.radius.sm,
                paddingHorizontal: t.spacing.sm,
              },
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.primaryInk }]}>Edit</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete accommodation: ${accommodation.name}`}
            onPress={() => void confirmDelete(accommodation, onDelete)}
            style={({ pressed }) => [
              styles.actionBtn,
              {
                backgroundColor: pressed ? t.colors.dangerLight : 'transparent',
                borderRadius: t.radius.sm,
                paddingHorizontal: t.spacing.sm,
              },
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.danger }]}>Delete</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Pill({ text, subtle }: { text: string; subtle?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: subtle ? t.colors.bgMuted : t.colors.gradientSubtle,
          borderRadius: t.radius.pill,
          paddingHorizontal: t.spacing.sm,
        },
      ]}
    >
      <Text style={[t.typography.small, { color: subtle ? t.colors.textMuted : t.colors.primaryInk, fontWeight: '600' }]}>
        {text}
      </Text>
    </View>
  );
}

function DateColumn({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text style={[t.typography.overline, { color: t.colors.textMuted }]}>{label}</Text>
      <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>{value}</Text>
    </View>
  );
}

function ConfirmationCode({ code }: { code: string }) {
  const t = useTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function handleCopy() {
    const ok = await copyToClipboard(code);
    if (!ok) return;
    haptics.success();
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <View
      style={[
        styles.row,
        styles.codeRow,
        { borderColor: t.colors.border, borderRadius: t.radius.md, paddingLeft: t.spacing.md, gap: t.spacing.sm },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[t.typography.overline, { color: t.colors.textMuted }]}>Confirmation</Text>
        <Text selectable style={[t.typography.bodyStrong, styles.mono, { color: t.colors.text }]}>
          {code}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copied ? 'Confirmation code copied' : `Copy confirmation code ${code}`}
        onPress={() => void handleCopy()}
        style={({ pressed }) => [
          styles.actionBtn,
          { backgroundColor: pressed ? t.colors.gradientSubtle : 'transparent', paddingHorizontal: t.spacing.md },
          Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
        ]}
      >
        <Text style={[t.typography.caption, { color: copied ? t.colors.success : t.colors.primaryInk, fontWeight: '700' }]}>
          {copied ? 'Copied ✓' : 'Copy'}
        </Text>
      </Pressable>
      {copied ? (
        <Text style={styles.srOnly} accessibilityLiveRegion="polite">
          Copied to clipboard
        </Text>
      ) : null}
    </View>
  );
}

/**
 * "Day X → Day Y" relative to the trip start date (local calendar math).
 * Returns null if the trip has no start date or the stay is entirely before it.
 */
function computeDayBridge(acc: TripAccommodation, tripStartDate: string | null): string | null {
  if (!tripStartDate) return null;
  const inDay = nightsBetween(tripStartDate, acc.check_in_date) + 1;
  const outDay = nightsBetween(tripStartDate, acc.check_out_date) + 1;
  // nightsBetween clamps negatives to 0 → a stay before the trip yields 1/1.
  if (acc.check_out_date < tripStartDate) return null;
  if (inDay === outDay) return `Day ${inDay}`;
  return `Day ${inDay} → Day ${outDay}`;
}

async function confirmDelete(acc: TripAccommodation, onDelete: () => void) {
  const confirmed = await confirmDestructive({
    title: 'Delete accommodation?',
    message: `Remove "${acc.name}"? This cannot be undone.`,
    confirmLabel: 'Delete',
  });
  if (confirmed) onDelete();
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  pill: { paddingVertical: 2 },
  navBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  actionBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  codeRow: { borderWidth: 1, borderStyle: 'dashed' },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), letterSpacing: 1 },
  srOnly: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
