/**
 * MemoryQuickActions — Today's "Add photo" + "Write today's journal"
 * (M5 Y3.1). Photos go to today's trip day (private by default); the journal
 * action opens the memories screen scrolled to today with the editor focused.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useT } from '@/i18n';
import { surfaceStyle, useTheme } from '@/theme';
import { TodayAction } from '@/components/today/TodayAction';
import { usePhotoUploads } from '@/api/memories';
import { useAddMemoryPhotos } from './useAddMemoryPhotos';
import { memoryErrorKey } from './memoryErrors';
import { summarizeUploads } from './MemoryStatus';

export interface MemoryQuickActionsProps {
  tripId: string;
  /** Today's 0-based trip day. */
  dayIndex: number;
}

export function MemoryQuickActions({ tripId, dayIndex }: MemoryQuickActionsProps) {
  const t = useTheme();
  const { t: tx } = useT('memories');
  const router = useRouter();
  const adder = useAddMemoryPhotos(tripId);
  const { jobs } = usePhotoUploads(tripId);
  const s = summarizeUploads(jobs);
  const status = adder.error
    ? tx(memoryErrorKey(adder.error))
    : s.failed > 0
      ? tx('upload.failedCount', { count: s.failed })
      : s.active > 0
        ? tx('upload.uploading', { count: s.active })
        : null;

  return (
    <View style={[surfaceStyle(t, 'raised'), { padding: t.spacing.lg, gap: t.spacing.md }]}>
      <Text accessibilityRole="header" style={[t.typography.subtitle, { color: t.colors.text }]}>
        {tx('today.heading')}
      </Text>
      <View style={[styles.row, { gap: t.spacing.sm }]}>
        <TodayAction
          icon="camera"
          variant="primary"
          label={adder.busy ? tx('today.adding') : tx('today.addPhoto')}
          disabled={adder.busy}
          onPress={() => void adder.pick({ dayIndex })}
          grow
        />
        <TodayAction
          icon="pencil"
          label={tx('today.writeJournal')}
          onPress={() => router.push(`/trip/${tripId}/memories?day=${dayIndex}&compose=journal` as Href)}
          grow
        />
      </View>
      {status ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[t.typography.small, { color: adder.error || s.failed > 0 ? t.colors.dangerText : t.colors.textMuted }]}
        >
          {status}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
});
