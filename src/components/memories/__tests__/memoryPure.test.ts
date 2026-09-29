/**
 * Pure helpers of the memories UI (M5 Y3.1): error-key mapping, the bulk
 * share target, trip-day merging and the upload summary.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { i18n } from '@/i18n';
import type { MemoryDayGroup, MemoryItem, PhotoUploadJobView } from '@/api/memories.types';
import { memoryErrorKey } from '../memoryErrors';

jest.mock('@/api', () => ({}));
jest.mock('@/api/memories', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/hooks/useTripRole', () => ({}));

// eslint-disable-next-line import/first
import { bulkTarget } from '../MemoryDaySection';
// eslint-disable-next-line import/first
import { summarizeUploads } from '../MemoryStatus';
// eslint-disable-next-line import/first
import { mergeTripDays } from '../memoriesTimeline';

type Case = [NonNullable<Parameters<typeof memoryErrorKey>[0]>, string];
const translate = i18n.t as unknown as (key: string, opts?: Record<string, unknown>) => string;

describe('memoryErrorKey', () => {
  it.each<Case>([
    [{ code: 'quota_exceeded', scope: 'user' }, 'errors.quota_user'],
    [{ code: 'quota_exceeded', scope: 'user_bytes' }, 'errors.quota_user_bytes'],
    [{ code: 'quota_exceeded', scope: 'pending' }, 'errors.quota_pending'],
    [{ code: 'quota_exceeded', scope: 'trip' }, 'errors.quota_trip'],
    [{ code: 'quota_exceeded', scope: 'global' }, 'errors.storage_full'],
    [{ code: 'storage_full' }, 'errors.storage_full'],
    [{ code: 'unsupported_image' }, 'errors.unsupported_image'],
    [{ code: 'network' }, 'errors.network'],
    [{ code: 'not_author' }, 'errors.forbidden'],
    [{ code: 'unknown' }, 'errors.generic'],
  ])('%o → %s', (info, key) => {
    expect(memoryErrorKey(info)).toBe(key);
    // every key resolves to real copy, in both languages
    expect(translate(`memories:${key}`)).not.toBe(key);
    expect(translate(`memories:${key}`, { lng: 'tr' })).not.toBe(key);
  });

  it('null → generic', () => {
    expect(memoryErrorKey(null)).toBe('errors.generic');
  });
});

function item(id: string, isOwn: boolean, visibility: 'only_me' | 'trip'): MemoryItem {
  return {
    kind: 'journal',
    id,
    tripId: 't',
    dayIndex: 0,
    at: '2026-01-01',
    isOwn,
    visibility,
    entry: {} as never,
  };
}

describe('bulkTarget', () => {
  it('shares when any own item is private', () => {
    expect(bulkTarget([item('a', true, 'trip'), item('b', true, 'only_me')])).toBe('trip');
  });
  it('makes private when every own item is shared', () => {
    expect(bulkTarget([item('a', true, 'trip'), item('b', false, 'only_me')])).toBe('only_me');
  });
  it('has no action without own items', () => {
    expect(bulkTarget([item('a', false, 'trip')])).toBeNull();
  });
});

describe('mergeTripDays', () => {
  it('fills every trip day, keeps extra days and puts undated last', () => {
    const groups: MemoryDayGroup[] = [
      { dayIndex: null, items: [item('u', true, 'only_me')] },
      { dayIndex: 1, items: [item('a', true, 'only_me')] },
      { dayIndex: 4, items: [item('b', true, 'only_me')] },
    ];
    const out = mergeTripDays(groups, 3);
    expect(out.map((g) => g.dayIndex)).toEqual([0, 1, 2, 3, 4, null]);
    expect(out[1]?.items).toHaveLength(1);
    expect(out[0]?.items).toHaveLength(0);
  });
  it('drops an empty undated group', () => {
    expect(mergeTripDays([{ dayIndex: null, items: [] }], 1).map((g) => g.dayIndex)).toEqual([0]);
  });
});

describe('summarizeUploads', () => {
  const job = (
    state: PhotoUploadJobView['state'],
    progress: number,
    waitingFor: PhotoUploadJobView['waitingFor'] = null,
  ) => ({ state, progress, waitingFor }) as PhotoUploadJobView;
  it('counts active, waiting and failed jobs', () => {
    const s = summarizeUploads([
      job('uploading', 0.5),
      job('waiting', 0, 'network'),
      job('waiting', 0.1, 'pending_slot'),
      job('failed', 0.2),
    ]);
    expect(s).toMatchObject({ active: 3, waitingNetwork: 1, waitingSlot: 1, failed: 1 });
    expect(s.progress).toBeCloseTo(0.2);
  });
});
