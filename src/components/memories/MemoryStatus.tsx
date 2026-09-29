/**
 * Memory status strips (M5 Y3.1):
 *   UploadStatusBar — this device's upload queue for the trip: "Uploading 3
 *     photos · 45%", waiting for a connection / a free slot, N failed with
 *     Retry all, and the "keep the app open" note when the queue could not
 *     store bytes durably.
 *   QuotaMeter — the photo quota (useMemoryQuota): photos and MB used, the
 *     trip cap, and the storage-full state. Hidden while unknown (offline).
 */
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useT, formatNumber, formatPercent } from '@/i18n';
import { surfaceStyle, useTheme } from '@/theme';
import type { MemoryQuota, PhotoUploadJobView } from '@/api/memories.types';

export interface UploadSummary {
  active: number;
  waitingNetwork: number;
  waitingSlot: number;
  failed: number;
  /** Mean progress of the active (queued / uploading / waiting) jobs, 0..1. */
  progress: number;
}

export function summarizeUploads(jobs: readonly PhotoUploadJobView[]): UploadSummary {
  let active = 0;
  let waitingNetwork = 0;
  let waitingSlot = 0;
  let failed = 0;
  let progressSum = 0;
  for (const j of jobs) {
    if (j.state === 'failed') {
      failed++;
      continue;
    }
    active++;
    progressSum += j.progress;
    if (j.state === 'waiting' && j.waitingFor === 'network') waitingNetwork++;
    else if (j.state === 'waiting' && j.waitingFor === 'pending_slot') waitingSlot++;
  }
  return { active, waitingNetwork, waitingSlot, failed, progress: active > 0 ? progressSum / active : 0 };
}

export function UploadStatusBar({
  jobs,
  durable,
  onRetryAll,
}: {
  jobs: readonly PhotoUploadJobView[];
  durable: boolean;
  onRetryAll: () => void;
}) {
  const t = useTheme();
  const { t: tx } = useT('memories');
  if (jobs.length === 0) return null;
  const s = summarizeUploads(jobs);
  const waitingNote =
    s.waitingNetwork > 0 ? tx('upload.waitingNetwork') : s.waitingSlot > 0 ? tx('upload.waitingSlot') : null;
  return (
    <View style={[surfaceStyle(t, 'raised'), { padding: t.spacing.md, gap: t.spacing.sm }]} accessibilityLiveRegion="polite">
      {s.active > 0 ? (
        <View style={{ gap: t.spacing.xs }}>
          <View style={[styles.row, { gap: t.spacing.sm }]}>
            <Icon name="upload" size={18} color={t.colors.primaryInk} />
            <Text style={[t.typography.bodyStrong, { color: t.colors.text, flex: 1 }]}>
              {tx('upload.uploading', { count: s.active })}
            </Text>
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{formatPercent(s.progress)}</Text>
          </View>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.track, { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.pill }]}
          >
            <View
              style={{
                width: `${Math.round(Math.max(0.03, s.progress) * 100)}%`,
                height: '100%',
                backgroundColor: t.colors.primary,
                borderRadius: t.radius.pill,
              }}
            />
          </View>
          {waitingNote ? <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{waitingNote}</Text> : null}
        </View>
      ) : null}
      {s.failed > 0 ? (
        <View style={[styles.row, { gap: t.spacing.sm }]}>
          <Icon name="alert-triangle" size={18} color={t.colors.dangerText} />
          <Text style={[t.typography.caption, { color: t.colors.dangerText, flex: 1 }]}>
            {tx('upload.failedCount', { count: s.failed })}
          </Text>
          <Button variant="secondary" label={tx('actions.retryAll')} onPress={onRetryAll} />
        </View>
      ) : null}
      {!durable ? <Text style={[t.typography.small, { color: t.colors.warningText }]}>{tx('upload.notDurable')}</Text> : null}
    </View>
  );
}

const MIB = 1024 * 1024;

export function QuotaMeter({ quota }: { quota: MemoryQuota | undefined }) {
  const t = useTheme();
  const { t: tx } = useT('memories');
  if (!quota) return null;
  const mb = (bytes: number) => formatNumber(bytes / MIB, { maximumFractionDigits: bytes < 10 * MIB ? 1 : 0 });
  const ratio = Math.max(
    quota.user_cap > 0 ? quota.user_used / quota.user_cap : 0,
    quota.user_bytes_cap > 0 ? quota.user_bytes / quota.user_bytes_cap : 0,
  );
  const tight = quota.storage_full || ratio >= 0.9;
  return (
    <View style={{ gap: 2 }}>
      <Text style={[t.typography.small, { color: tight ? t.colors.warningText : t.colors.textMuted }]}>
        {tx('quota.summary', {
          used: formatNumber(quota.user_used),
          cap: formatNumber(quota.user_cap),
          mbUsed: mb(quota.user_bytes),
          mbCap: mb(quota.user_bytes_cap),
        })}
      </Text>
      {quota.trip_used !== null && quota.trip_cap !== null ? (
        <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
          {tx('quota.trip', { used: formatNumber(quota.trip_used), cap: formatNumber(quota.trip_cap) })}
        </Text>
      ) : null}
      {quota.storage_full ? (
        <Text style={[t.typography.small, { color: t.colors.dangerText }]} accessibilityLiveRegion="polite">
          {tx('errors.storage_full')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  track: { height: 6, width: '100%', overflow: 'hidden' },
});
