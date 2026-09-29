/**
 * PlaceReviewBlock — "Your rating & review" on place detail (M5 Y3.1).
 *
 * The user's OWN 1–5 stars + text, kept visually apart from "Reviews from
 * Google" (a tinted card with its own heading, never Google's star colour
 * row). Stars save on tap; the text saves on Save / blur. PRIVATE by
 * default; the "Share with trip" switch flips visibility. Below: trip-mates'
 * SHARED reviews of this place (never Google content), which the trip
 * owner can remove.
 *
 * Offline-safe (Tier-1). `canWrite=false` (the user left the trip): the own
 * review stays readable and can still be unshared or deleted.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useT } from '@/i18n';
import { surfaceStyle, useTheme } from '@/theme';
import { confirmDestructive } from '@/lib/confirm';
import {
  useDeleteMemory,
  usePlaceReviews,
  useRemoveTripMemory,
  useSetMemoryVisibility,
  useUpsertPlaceReview,
} from '@/api/memories';
import type { MemoryVisibility, TripPlaceReview } from '@/api/memories.types';
import { StarRating } from './StarRating';
import { VisibilityToggle } from './VisibilityToggle';
import { errorInfoOf, memoryErrorKey, type MemoryErrorKey } from './memoryErrors';

export interface PlaceReviewBlockProps {
  tripId: string;
  tripPlaceId: string;
  canWrite: boolean;
  isOwner: boolean;
}

export function PlaceReviewBlock({ tripId, tripPlaceId, canWrite, isOwner }: PlaceReviewBlockProps) {
  const t = useTheme();
  const { t: tx } = useT(['memories', 'common']);
  const { mine, others, isLoading } = usePlaceReviews(tripId, tripPlaceId);
  const upsert = useUpsertPlaceReview();
  const setVisibility = useSetMemoryVisibility();
  const del = useDeleteMemory();
  const remove = useRemoveTripMemory();

  const storedBody = mine?.body ?? '';
  const [draft, setDraft] = useState(storedBody);
  const [editing, setEditing] = useState(false);
  const [pendingVisibility, setPendingVisibility] = useState<MemoryVisibility>('only_me');
  const [errorKey, setErrorKey] = useState<MemoryErrorKey | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(storedBody);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- adopt the stored text when not mid-edit
  }, [mine?.id, storedBody]);

  const visibility: MemoryVisibility = mine?.visibility ?? pendingVisibility;
  const dirty = draft !== storedBody;
  const fail = (e: unknown) => setErrorKey(memoryErrorKey(errorInfoOf(e)));

  const upsertWith = (patch: { rating?: number | null; body?: string }) => {
    setErrorKey(null);
    const input: Parameters<typeof upsert.mutateAsync>[0] = { tripId, tripPlaceId, ...patch };
    if (!mine) input.visibility = pendingVisibility;
    return upsert.mutateAsync(input);
  };

  const onRate = (rating: number | null) => {
    if (!canWrite) return;
    upsertWith({ rating }).catch(fail);
  };

  const onSaveText = async () => {
    if (!canWrite || !dirty || savingRef.current) return;
    savingRef.current = true;
    try {
      await upsertWith({ body: draft });
      setEditing(false);
      setSavedFlash(true);
    } catch (e) {
      fail(e);
    } finally {
      savingRef.current = false;
    }
  };

  const onVisibility = (next: MemoryVisibility) => {
    setErrorKey(null);
    if (!mine) {
      setPendingVisibility(next);
      return;
    }
    setVisibility.mutate({ tripId, items: [{ kind: 'review', id: mine.id }], visibility: next }, { onError: fail });
  };

  const onDelete = async () => {
    if (!mine) return;
    const ok = await confirmDestructive({
      title: tx('review.deleteTitle'),
      message: tx('review.deleteBody'),
      confirmLabel: tx('actions.delete'),
      cancelLabel: tx('common:actions.cancel'),
    });
    if (!ok) return;
    del.mutate({ tripId, kind: 'review', id: mine.id }, { onError: fail });
  };

  const onRemoveOther = async (review: TripPlaceReview) => {
    const ok = await confirmDestructive({
      title: tx('moderation.title'),
      message: tx('moderation.body'),
      confirmLabel: tx('actions.removeFromTrip'),
      cancelLabel: tx('common:actions.cancel'),
    });
    if (!ok) return;
    remove.mutate({ tripId, kind: 'review', id: review.id }, { onError: fail });
  };

  return (
    <View
      style={[
        surfaceStyle(t, 'flat'),
        { backgroundColor: t.colors.gradientSubtle, padding: t.spacing.lg, gap: t.spacing.md },
      ]}
    >
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" aria-level={2} style={[t.typography.subtitle, { color: t.colors.text }]}>
          {tx('review.heading')}
        </Text>
        <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('review.subheading')}</Text>
      </View>

      {isLoading ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{tx('review.loading')}</Text>
      ) : (
        <>
          <StarRating value={mine?.rating ?? null} onChange={canWrite ? onRate : undefined} disabled={upsert.isPending} />
          <TextInput
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              setEditing(true);
              setSavedFlash(false);
            }}
            onBlur={() => void onSaveText()}
            editable={canWrite}
            multiline
            maxLength={4000}
            placeholder={tx('review.placeholder')}
            placeholderTextColor={t.colors.textMuted}
            accessibilityLabel={tx('review.bodyLabel')}
            style={[
              t.typography.body,
              styles.input,
              {
                color: t.colors.text,
                backgroundColor: t.colors.bgElevated,
                borderColor: t.colors.border,
                borderRadius: t.radius.md,
                padding: t.spacing.md,
              },
            ]}
          />
          <View style={[styles.row, { gap: t.spacing.sm }]}>
            <Text style={[t.typography.small, { color: t.colors.textMuted, flex: 1 }]} accessibilityLiveRegion="polite">
              {dirty ? tx('journal.unsaved') : savedFlash ? tx('journal.saved') : ''}
            </Text>
            {mine ? <Button variant="ghost" label={tx('actions.delete')} onPress={() => void onDelete()} /> : null}
            {canWrite ? (
              <Button
                variant="secondary"
                label={tx('actions.save')}
                onPress={() => void onSaveText()}
                disabled={!dirty}
                loading={upsert.isPending && dirty}
              />
            ) : null}
          </View>
          {mine || canWrite ? (
            <VisibilityToggle visibility={visibility} onChange={onVisibility} itemLabel={tx('items.review')} />
          ) : null}
        </>
      )}

      {errorKey ? (
        <Text style={[t.typography.small, { color: t.colors.dangerText }]} accessibilityLiveRegion="polite">
          {tx(errorKey)}
        </Text>
      ) : null}

      {others.length > 0 ? (
        <View style={{ gap: t.spacing.sm }}>
          <Text accessibilityRole="header" aria-level={3} style={[t.typography.bodyStrong, { color: t.colors.text }]}>
            {tx('review.others')}
          </Text>
          {others.map((r) => (
            <View
              key={r.id}
              style={[surfaceStyle(t, 'flat'), { padding: t.spacing.md, gap: t.spacing.xs, backgroundColor: t.colors.bgElevated }]}
            >
              <View style={[styles.row, { gap: t.spacing.sm }]}>
                <Icon name="users" size={14} color={t.colors.textMuted} />
                <Text style={[t.typography.small, { color: t.colors.textMuted, flex: 1 }]}>{tx('by.tripmate')}</Text>
                <StarRating value={r.rating} size={14} />
              </View>
              {r.body ? <Text style={[t.typography.body, { color: t.colors.text }]}>{r.body}</Text> : null}
              {isOwner ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tx('actions.removeFromTrip')}
                  onPress={() => void onRemoveOther(r)}
                  style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={[t.typography.caption, { color: t.colors.dangerText }]}>{tx('actions.removeFromTrip')}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 88, borderWidth: 1, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
