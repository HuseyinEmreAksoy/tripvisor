/**
 * SyncStatusPill — S2.7 sync-status surface, upgraded with the S2.8.9
 * issues sheet (v2 S2.8 flag-flip wave).
 *
 * Compact header pill reading {@link useSyncStatus} (src/sync/telemetry.ts).
 * Renders NOTHING while the Tier-1 sync engine is not enabled — flag off
 * means invisible: no element, zero layout shift, v1 header byte-identical.
 *
 * States (first match wins — most actionable information on top):
 *   1. "Sync issues (N)"            warning tint, N = Σ per-entity
 *      writeErrorCount + tosViolations (the queue depth itself is not
 *      observable — telemetry.ts documents that writeErrorCount is the
 *      proxy).
 *   2. "Open in another tab"        muted, degraded because another tab holds
 *      the OPFS access handle (isOtherTabLockReason).
 *   2b. "Local-only mode"           muted, when persistence degraded to
 *      in-memory (R5). Outranks "Offline" because offline + degraded means
 *      changes survive only this session — saying "saved here" would
 *      overpromise.
 *   3. "Offline — changes saved here"  muted, when useIsOnline() is false.
 *   4. "Synced · 2m"                success tint, relative age of the
 *      OLDEST entity sync (lastSyncAgeMs); "Syncing…" (muted) until every
 *      entity has hydrated at least once (lastSyncAgeMs === null).
 *
 * S2.8.9: the pill is tappable in EVERY state and opens a BottomSheet:
 *   - per-entity write errors (only entities that HAVE errors — the
 *     dead-letter proxy; honest copy: "will keep retrying"),
 *   - degraded + degradedReason in platform-specific plain copy (web: a
 *     reload loses offline changes in this browser; native: an app update
 *     fixes it) — in-memory means "kept on this device only this session",
 *   - tosViolations count (dev-facing; reported automatically),
 *   - last-sync age sentence,
 *   - resolver actions: "Retry now" → resyncTier1() (the same force-pull
 *     the reconnect listener runs; queued writes retry on the engine's own
 *     backoff — copy says "retry", never "fix"), "Refresh data" →
 *     resyncTier1() + invalidate trips/trip-places TanStack queries (covers
 *     the flag-off-fallback read path too), and "Dismiss".
 *
 * The relative age refreshes on a 30 s interval re-render — useSyncStatus
 * recomputes lastSyncAgeMs from Date.now() on every render, so no extra
 * bookkeeping is needed.
 */
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/theme';
import { useIsOnline } from '@/api/offline';
import { tripsKeys, tripPlacesKeys } from '@/api';
import { useSyncStatus } from '@/sync/telemetry';
import type { SyncEntityTelemetry } from '@/sync/telemetry';
import { resyncTier1 } from '@/sync/hydrate';
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

/** Spoken/relative phrase: "just now" / "5 min ago" / "2 h ago" / "3 days ago". */
export function relativeAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function lastSyncSentence(ageMs: number | null): string {
  if (ageMs === null) return 'First sync has not finished yet.';
  return `Last synced ${relativeAge(ageMs)}.`;
}

/**
 * The web persistence layer (src/sync/persistence.web.ts) degrades with a
 * free-text reason. When another tab of the app already holds the OPFS sync
 * access handle, wa-sqlite fails with `NoModificationAllowedError … another
 * open Access Handle` — a benign, user-fixable cause with its own copy.
 */
export function isOtherTabLockReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return /NoModificationAllowedError|access handles?|createSyncAccessHandle/i.test(reason);
}

const OTHER_TAB_NOTE =
  "Tripvisor is open in another tab — changes here sync while online but aren't saved on this device until you close the other tab.";

/** Honest per-entity problem summary — write errors are the dead-letter
 * proxy (queue depth is not observable); read errors are consecutive. */
function problemSummary(e: SyncEntityTelemetry): string {
  const parts: string[] = [];
  if (e.writeErrorCount > 0) {
    parts.push(
      `${e.writeErrorCount} change${e.writeErrorCount === 1 ? '' : 's'} couldn't be sent yet (will keep retrying)`,
    );
  }
  if (e.errorCount > 0) {
    parts.push(
      `${e.errorCount} failed read attempt${e.errorCount === 1 ? '' : 's'} since the last success`,
    );
  }
  return parts.join(' · ');
}

export function SyncStatusPill() {
  const t = useTheme();
  const status = useSyncStatus();
  const online = useIsOnline();
  const qc = useQueryClient();
  const [detailOpen, setDetailOpen] = useState(false);
  const [retryRequested, setRetryRequested] = useState(false);

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
  const problemRows = entityRows.filter(
    ([, e]) => e.writeErrorCount > 0 || e.errorCount > 0,
  );
  const writeErrors = entityRows.reduce((sum, [, e]) => sum + e.writeErrorCount, 0);
  const issueCount = writeErrors + status.tosViolations;
  const otherTab = status.degraded && isOtherTabLockReason(status.degradedReason);
  const healthy = problemRows.length === 0 && !status.degraded && status.tosViolations === 0;

  let label: string;
  let a11yLabel: string;
  let bg: string;
  let fg: string;

  if (issueCount > 0) {
    label = `Sync issues (${issueCount})`;
    a11yLabel = `${issueCount} sync issue${issueCount === 1 ? '' : 's'}. Tap for details.`;
    bg = t.colors.warningLight;
    fg = t.colors.warningText;
  } else if (otherTab) {
    label = 'Open in another tab';
    a11yLabel = `${OTHER_TAB_NOTE} Tap for details.`;
    bg = t.colors.bgMuted;
    fg = t.colors.textMuted;
  } else if (status.degraded) {
    label = 'Local-only mode';
    a11yLabel =
      'Local-only mode: device storage is unavailable, so changes are kept on this device only for this session and sync while the app is open. Tap for details.';
    bg = t.colors.bgMuted;
    fg = t.colors.textMuted;
  } else if (!online) {
    label = 'Offline — changes saved here';
    a11yLabel =
      'You are offline. Changes are saved on this device and sync when you reconnect. Tap for details.';
    bg = t.colors.bgMuted;
    fg = t.colors.textMuted;
  } else if (status.lastSyncAgeMs === null) {
    label = 'Syncing…';
    a11yLabel = 'Sync in progress. Tap for details.';
    bg = t.colors.bgMuted;
    fg = t.colors.textMuted;
  } else {
    label = `Synced · ${formatAge(status.lastSyncAgeMs)}`;
    a11yLabel = `Synced. Last synced ${relativeAge(status.lastSyncAgeMs)}. Tap for details.`;
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

  const closeSheet = () => {
    setDetailOpen(false);
    setRetryRequested(false);
  };

  // "Retry now" — the honest action: re-run the same incremental force-pull
  // the reconnect listener fires; queued writes retry on the engine's own
  // backoff. It cannot "fix" a server rejection, hence the copy.
  const handleRetryNow = () => {
    resyncTier1();
    setRetryRequested(true);
  };

  // "Refresh data" — resync the Tier-1 store AND invalidate the TanStack
  // trips/places queries so the flag-off-fallback read path refetches too.
  const handleRefreshData = () => {
    resyncTier1();
    void qc.invalidateQueries({ queryKey: tripsKeys.all });
    void qc.invalidateQueries({ queryKey: tripPlacesKeys.all });
    closeSheet();
  };

  // Platform-specific degraded copy (S2.8.9): in-memory means changes are
  // kept on this device only this session. Web un-degrades once COOP/COEP
  // headers land (S2.8.10) in Chromium/Firefox — Safari has no
  // `credentialless` and stays here by design (R5). Native degrade means a
  // pre-SQLite dev-client build → an app update fixes it.
  const degradedNote = otherTab
    ? OTHER_TAB_NOTE
    : Platform.OS === 'web'
      ? "Local-only mode: this browser can't store sync data right now, so offline changes won't survive a reload. Changes are kept on this device only this session and sync while the app is open."
      : "Local-only mode: this app version can't store sync data on the device yet. Changes are kept on this device only this session and sync while the app is open — updating the app fixes this.";

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        // Polite announce on state-label changes (Synced → Offline → …).
        accessibilityLiveRegion="polite"
        onPress={() => setDetailOpen(true)}
        hitSlop={6}
        style={({ pressed }) => [
          ...pillStyle,
          { opacity: pressed ? 0.6 : 1 },
          Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
        ]}
      >
        <Text style={[t.typography.small, { color: fg, fontWeight: '700' }]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>

      {/* S2.8.9 issues sheet — problems first, then the synced-data overview,
          then the resolver actions. */}
      <BottomSheet
        visible={detailOpen}
        onClose={closeSheet}
        accessibilityLabel="Sync status details"
      >
        <Text
          style={[t.typography.subtitle, { color: t.colors.text }]}
          accessibilityRole="header"
        >
          Sync status
        </Text>

        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          {lastSyncSentence(status.lastSyncAgeMs)}
          {!online
            ? ' You are offline — changes are saved on this device and sync when you reconnect.'
            : ''}
        </Text>

        {healthy ? (
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            No sync problems on this device.
          </Text>
        ) : null}

        {problemRows.map(([table, entity]) => (
          <View
            key={table}
            style={[
              styles.entityRow,
              {
                backgroundColor: t.colors.warningLight,
                borderRadius: t.radius.md,
                paddingHorizontal: t.spacing.md,
                paddingVertical: t.spacing.sm,
              },
            ]}
            accessible
            accessibilityLabel={`${TABLE_LABELS[table] ?? table}: ${problemSummary(entity)}.`}
          >
            <Text style={[t.typography.bodyStrong, { color: t.colors.warningText }]}>
              {TABLE_LABELS[table] ?? table}
            </Text>
            <Text style={[t.typography.caption, { color: t.colors.warningText }]}>
              {problemSummary(entity)}
            </Text>
          </View>
        ))}

        {status.degraded ? (
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            {degradedNote}
            {status.degradedReason ? `\nReason: ${status.degradedReason}` : ''}
          </Text>
        ) : null}

        {status.tosViolations > 0 ? (
          <Text style={[t.typography.caption, { color: t.colors.warningText }]}>
            {`Restricted-field strips: ${status.tosViolations} (reported automatically — nothing to do here).`}
          </Text>
        ) : null}

        {/* Synced-data overview (carried over from S2.7) */}
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
              accessibilityLabel={`${TABLE_LABELS[table] ?? table}: ${entity.rowCount} rows synced to this device.`}
            >
              <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
                {TABLE_LABELS[table] ?? table}
              </Text>
              <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
                {`${entity.rowCount} row${entity.rowCount === 1 ? '' : 's'} on this device`}
              </Text>
            </View>
          ))}
        </View>

        {retryRequested ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[t.typography.caption, { color: t.colors.success }]}
          >
            Retry requested — pulling the latest changes now.
          </Text>
        ) : null}

        <Button label="Retry now" onPress={handleRetryNow} />
        <Button label="Refresh data" variant="secondary" onPress={handleRefreshData} />
        <Button label="Dismiss" variant="ghost" onPress={closeSheet} />
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
