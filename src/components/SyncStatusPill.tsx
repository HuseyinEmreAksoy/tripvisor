/**
 * SyncStatusPill — S2.7 sync-status surface (v2 S2 Wave 3b).
 *
 * Compact header pill reading {@link useSyncStatus} (src/sync/telemetry.ts).
 * Renders NOTHING while the Tier-1 sync engine is not enabled — flag off
 * means invisible: no element, zero layout shift, v1 header byte-identical.
 *
 * States (first match wins — most actionable information on top):
 *   1. "Sync issues (N)"            warning tint, N = Σ per-entity
 *      writeErrorCount + tosViolations (the queue depth itself is not
 *      observable — telemetry.ts documents that writeErrorCount is the
 *      proxy). Tapping opens a read-only BottomSheet with per-entity
 *      counts + degradedReason. No resolver actions this wave.
 *   2. "Local-only mode"            muted, when persistence degraded to
 *      in-memory (R5). Outranks "Offline" because offline + degraded means
 *      changes survive only this session — saying "saved here" would
 *      overpromise. Tappable → same detail sheet (the explanation).
 *   3. "Offline — changes saved here"  muted, when useIsOnline() is false.
 *   4. "Synced · 2m"                success tint, relative age of the
 *      OLDEST entity sync (lastSyncAgeMs); "Syncing…" (muted) until every
 *      entity has hydrated at least once (lastSyncAgeMs === null).
 *
 * The relative age refreshes on a 30 s interval re-render — useSyncStatus
 * recomputes lastSyncAgeMs from Date.now() on every render, so no extra
 * bookkeeping is needed.
 */
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { useIsOnline } from '@/api/offline';
import { useSyncStatus } from '@/sync/telemetry';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';

/** Human labels for the Tier-1 tables (entities keys). Unknown tables — a
 * future write-slice expansion — fall back to the raw table name. */
const TABLE_LABELS: Record<string, string> = {
  trips: 'Trips',
  trip_places: 'Places',
};

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function SyncStatusPill() {
  const t = useTheme();
  const status = useSyncStatus();
  const online = useIsOnline();
  const [detailOpen, setDetailOpen] = useState(false);

  // Keep the "· 2m" age honest between telemetry changes: a 30 s tick
  // re-renders; useSyncStatus() recomputes the age per render.
  const [, setAgeTick] = useState(0);
  useEffect(() => {
    if (!status.enabled) return undefined;
    const id = setInterval(() => setAgeTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [status.enabled]);

  // Flag off / engine torn down → invisible (hooks above ran unconditionally).
  if (!status.enabled) return null;

  const entityRows = Object.entries(status.entities);
  const writeErrors = entityRows.reduce((sum, [, e]) => sum + e.writeErrorCount, 0);
  const issueCount = writeErrors + status.tosViolations;

  let label: string;
  let a11yLabel: string;
  let bg: string;
  let fg: string;
  let tappable = false;

  if (issueCount > 0) {
    label = `Sync issues (${issueCount})`;
    a11yLabel = `${issueCount} sync issue${issueCount === 1 ? '' : 's'}. Tap for details.`;
    bg = t.colors.warningLight;
    fg = t.colors.warningText;
    tappable = true;
  } else if (status.degraded) {
    label = 'Local-only mode';
    a11yLabel =
      'Local-only mode: device storage is unavailable, so changes are kept in memory for this session and sync while the app is open. Tap for details.';
    bg = t.colors.bgMuted;
    fg = t.colors.textMuted;
    tappable = true;
  } else if (!online) {
    label = 'Offline — changes saved here';
    a11yLabel = 'You are offline. Changes are saved on this device and sync when you reconnect.';
    bg = t.colors.bgMuted;
    fg = t.colors.textMuted;
  } else if (status.lastSyncAgeMs === null) {
    label = 'Syncing…';
    a11yLabel = 'Sync in progress.';
    bg = t.colors.bgMuted;
    fg = t.colors.textMuted;
  } else {
    label = `Synced · ${formatAge(status.lastSyncAgeMs)}`;
    a11yLabel = `Synced. Last sync ${formatAge(status.lastSyncAgeMs)} ago.`;
    bg = t.colors.successLight;
    fg = t.colors.success;
  }

  const pillStyle = [
    styles.pill,
    {
      backgroundColor: bg,
      borderRadius: t.radius.pill,
      paddingHorizontal: t.spacing.md,
    },
  ];
  const pillText = (
    <Text style={[t.typography.small, { color: fg, fontWeight: '700' }]} numberOfLines={1}>
      {label}
    </Text>
  );

  return (
    <>
      {tappable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          onPress={() => setDetailOpen(true)}
          hitSlop={6}
          style={({ pressed }) => [
            ...pillStyle,
            { opacity: pressed ? 0.6 : 1 },
            Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
          ]}
        >
          {pillText}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={a11yLabel} accessibilityLiveRegion="polite" style={pillStyle}>
          {pillText}
        </View>
      )}

      {/* Read-only detail sheet — per-entity counts + degradedReason. No
          resolver actions this wave (S2.7 scope). */}
      <BottomSheet
        visible={detailOpen}
        onClose={() => setDetailOpen(false)}
        accessibilityLabel="Sync status details"
      >
        <Text
          style={[t.typography.subtitle, { color: t.colors.text }]}
          accessibilityRole="header"
        >
          Sync status
        </Text>

        {status.degraded ? (
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            {'Local-only mode: device storage is unavailable, so changes live in memory for this session. Sync still works while the app is open; offline cold-start needs storage.'}
            {status.degradedReason ? `\nReason: ${status.degradedReason}` : ''}
          </Text>
        ) : null}

        {status.tosViolations > 0 ? (
          <Text style={[t.typography.caption, { color: t.colors.warningText }]}>
            {`Restricted-field strips: ${status.tosViolations} (reported automatically — nothing to do here).`}
          </Text>
        ) : null}

        <View style={{ gap: t.spacing.sm }}>
          {entityRows.map(([table, entity]) => (
            <View
              key={table}
              style={[
                styles.entityRow,
                {
                  backgroundColor: t.colors.bgMuted,
                  borderRadius: t.radius.md,
                  paddingHorizontal: t.spacing.md,
                  paddingVertical: t.spacing.sm,
                },
              ]}
              accessible
              accessibilityLabel={`${TABLE_LABELS[table] ?? table}: ${entity.rowCount} rows synced, ${entity.writeErrorCount} write errors, ${entity.errorCount} read errors.`}
            >
              <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
                {TABLE_LABELS[table] ?? table}
              </Text>
              <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
                {`${entity.rowCount} rows · ${entity.writeErrorCount} write error${entity.writeErrorCount === 1 ? '' : 's'} · ${entity.errorCount} read error${entity.errorCount === 1 ? '' : 's'}`}
              </Text>
            </View>
          ))}
        </View>

        <Button label="Close" variant="secondary" onPress={() => setDetailOpen(false)} />
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    minHeight: 26,
    paddingVertical: 3,
    // The header row is width-constrained on phones — let the pill shrink
    // and ellipsize rather than push the Insights/Settings buttons around.
    flexShrink: 1,
  },
  entityRow: {
    gap: 2,
  },
});
