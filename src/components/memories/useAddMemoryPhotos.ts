/**
 * useAddMemoryPhotos — pick photos from the library and hand them to the
 * Y2.1 pipeline (M5 Y3.1).
 *
 * `result.assets` goes STRAIGHT into useAddPhotos: the pipeline reads the
 * capture date from `exif`, re-encodes (EXIF/GPS stripped) and queues the
 * upload, so the original file never leaves the device. Works offline (the
 * queue uploads when back online).
 *
 * dayIndex: a number / null pins the day (null = undated); `undefined`
 * derives it from each photo's capture date.
 *
 * Native: expo-image-picker is a native module → a NEW native build is
 * needed. The system photo picker needs no runtime permission on Android 13+
 * / iOS 14+; app.json carries NSPhotoLibraryUsageDescription for older iOS.
 */
import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { useAddPhotos, type AddPhotosResult } from '@/api/memories';
import type { MemoryErrorInfo, MemoryVisibility } from '@/api/memories.types';
import { errorInfoOf } from './memoryErrors';

/** Max photos per pick (the server pending cap is 20). */
export const PICK_LIMIT = 20;

export interface AddMemoryPhotosState {
  /** Opens the picker, then enqueues the picked photos. */
  pick: (opts?: { dayIndex?: number | null; tripPlaceId?: string | null; visibility?: MemoryVisibility }) => Promise<void>;
  /** Picker open or photos being prepared (re-encode happens before enqueue). */
  busy: boolean;
  /** Everything failed (quota, unsupported…) or the picker itself failed. */
  error: Pick<MemoryErrorInfo, 'code' | 'scope'> | null;
  /** Some (not all) photos were rejected on the last pick. */
  partialFailures: number;
  lastResult: AddPhotosResult | null;
  clearError: () => void;
}

export function useAddMemoryPhotos(tripId: string | undefined): AddMemoryPhotosState {
  const add = useAddPhotos();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<Pick<MemoryErrorInfo, 'code' | 'scope'> | null>(null);
  const [partialFailures, setPartialFailures] = useState(0);
  const [lastResult, setLastResult] = useState<AddPhotosResult | null>(null);
  const { mutateAsync } = add;

  const pick = useCallback<AddMemoryPhotosState['pick']>(
    async (opts = {}) => {
      if (!tripId) return;
      setError(null);
      setPartialFailures(0);
      setPicking(true);
      let assets: ImagePicker.ImagePickerAsset[] = [];
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          selectionLimit: PICK_LIMIT,
          exif: true,
          quality: 1,
        });
        if (result.canceled || !result.assets || result.assets.length === 0) return;
        assets = result.assets;
      } catch {
        setError({ code: 'unknown' });
        return;
      } finally {
        setPicking(false);
      }
      try {
        const input: Parameters<typeof mutateAsync>[0] = { tripId, assets };
        if (opts.dayIndex !== undefined) input.dayIndex = opts.dayIndex;
        if (opts.tripPlaceId) input.tripPlaceId = opts.tripPlaceId;
        if (opts.visibility) input.visibility = opts.visibility;
        const res = await mutateAsync(input);
        setLastResult(res);
        setPartialFailures(res.failed.length);
        if (res.failed.length > 0 && res.ids.length === 0) setError(res.failed[0]?.error ?? { code: 'unknown' });
      } catch (e) {
        setError(errorInfoOf(e) ?? { code: 'unknown' });
      }
    },
    [tripId, mutateAsync],
  );

  return {
    pick,
    busy: picking || add.isPending,
    error,
    partialFailures,
    lastResult,
    clearError: () => {
      setError(null);
      setPartialFailures(0);
    },
  };
}
