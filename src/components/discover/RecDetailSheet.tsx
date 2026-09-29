/**
 * RecDetailSheet — tap on a Discover card (M5 Y3.4).
 *
 * 1. Resolves the card to a Google place with ONE metered autocomplete call
 *    (`useRecGoogleMatch`, memory-only), then reads the rating and up to 3
 *    reviews through the existing place-details hook (Tier-2, never
 *    persisted, "Powered by Google" + per-review author attribution).
 * 2. "Add to Ideas / Day N" through `useAddPoiToTrip`, passing the resolved
 *    match so the add costs no second search. Errors map to
 *    `discover:addError.*`; `scheduled === false` means the place landed in
 *    Ideas.
 * Only the Google place id + OSM coordinates + the card name are stored.
 */
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/theme';
import { formatDistance, formatNumber, useT } from '@/i18n';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { PoweredByGoogle } from '@/components/PoweredByGoogle';
import { Skeleton } from '@/components/Skeleton';
import { usePlaceDetails, newAutocompleteSessionToken } from '@/api/places';
import { useAddPoiToTrip, type AddPoiToTripResult, type PoiItem } from '@/api/recommendations';
import type { PlaceReview } from '@/api/types';
import { haptics } from '@/lib/haptics';
import { addPoiErrorKey, safeHttpUrl, type AddPoiErrorKey } from './discoverModel';
import { useRecGoogleMatch } from './useRecGoogleMatch';

const DETAIL_FIELDS = ['id', 'displayName', 'rating', 'userRatingCount', 'reviews', 'googleMapsUri'];
const REVIEW_LIMIT = 3;

export interface RecDetailSheetProps {
  item: PoiItem | null;
  tripId: string;
  dayCount: number;
  /** Pre-selected target (the day Discover searches around), null = Ideas. */
  defaultDayIndex: number | null;
  canEdit: boolean;
  existingGooglePlaceIds: readonly string[];
  onClose: () => void;
}

type Outcome =
  | { kind: 'added'; result: AddPoiToTripResult; dayIndex: number | null; name: string }
  | { kind: 'error'; key: AddPoiErrorKey };

export function RecDetailSheet({
  item,
  tripId,
  dayCount,
  defaultDayIndex,
  canEdit,
  existingGooglePlaceIds,
  onClose,
}: RecDetailSheetProps) {
  const t = useTheme();
  const { t: tx } = useT(['discover']);
  const [target, setTarget] = useState<number | null>(defaultDayIndex);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // One autocomplete session per opened card (match + details + add).
  const sessionToken = useMemo(() => (item ? newAutocompleteSessionToken() : undefined), [item]);
  const add = useAddPoiToTrip(tripId);

  useEffect(() => {
    setTarget(defaultDayIndex !== null && defaultDayIndex < dayCount ? defaultDayIndex : null);
    setOutcome(null);
    // Reset per card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  const match = useRecGoogleMatch(item, sessionToken);
  const placeId = match.data?.placeId;
  const details = usePlaceDetails({ placeId, sessionToken, fields: DETAIL_FIELDS, enabled: !!placeId });

  const matchErrorKey = match.error ? addPoiErrorKey(match.error) : null;
  const place = details.data ?? null;
  const reviews = (place?.reviews ?? []).slice(0, REVIEW_LIMIT);
  const mapsUrl = safeHttpUrl(place?.googleMapsUri);
  const alreadyAdded = outcome?.kind === 'added';

  const onAdd = () => {
    if (!item) return;
    setOutcome(null);
    add.mutate(
      {
        poi: item,
        dayIndex: target,
        existingGooglePlaceIds,
        sessionToken,
        match: match.data ?? undefined,
      },
      {
        onSuccess: (result) => {
          haptics.success();
          setOutcome({ kind: 'added', result, dayIndex: target, name: item.name });
        },
        onError: (err) => {
          haptics.error();
          setOutcome({ kind: 'error', key: addPoiErrorKey(err) });
        },
      },
    );
  };

  const addedMessage = (o: Extract<Outcome, { kind: 'added' }>) => {
    if (o.dayIndex === null || o.result.scheduled === null) return tx('detail.addedIdeas');
    if (o.result.scheduled === false) return tx('detail.movedToIdeas', { n: o.dayIndex + 1 });
    return tx('detail.addedDay', { n: o.dayIndex + 1 });
  };

  return (
    <BottomSheet visible={item !== null} onClose={onClose} accessibilityLabel={tx('detail.sheetA11y')}>
      {item ? (
        <ScrollView style={styles.scroll} contentContainerStyle={{ gap: t.spacing.md }}>
          <View style={[styles.headRow, { gap: t.spacing.md }]}>
            {safeHttpUrl(item.wiki?.thumbUrl) ? (
              <Image
                source={{ uri: safeHttpUrl(item.wiki?.thumbUrl)! }}
                style={{ width: 64, height: 64, borderRadius: t.radius.md, backgroundColor: t.colors.bgMuted }}
                contentFit="cover"
                accessibilityElementsHidden
                importantForAccessibility="no"
                aria-hidden
              />
            ) : null}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header" aria-level={2}>
                {item.name}
              </Text>
              <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                {tx('distanceAway', { distance: formatDistance(item.distanceM) })}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tx('detail.close')}
              onPress={onClose}
              hitSlop={8}
              style={styles.close}
            >
              <Icon name="x" size={22} color={t.colors.textMuted} />
            </Pressable>
          </View>

          {/* Google rating + reviews (Tier-2, on tap only). */}
          <View style={{ gap: t.spacing.sm }} testID="rec-google">
            {match.isLoading || (placeId && details.isLoading) ? (
              <View style={{ gap: t.spacing.sm }} accessibilityLiveRegion="polite" aria-live="polite">
                <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('detail.resolving')}</Text>
                <Skeleton width="50%" height={18} />
                <Skeleton width="100%" height={48} />
              </View>
            ) : matchErrorKey ? (
              <Text style={[t.typography.small, { color: t.colors.textMuted }]} accessibilityLiveRegion="polite">
                {tx(matchErrorKey)}
              </Text>
            ) : details.error ? (
              <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('detail.detailsError')}</Text>
            ) : place ? (
              <>
                {place.rating != null ? (
                  <View
                    style={[styles.headRow, { gap: t.spacing.xs }]}
                    accessible
                    accessibilityLabel={tx('detail.ratingA11y', { rating: formatNumber(place.rating, { maximumFractionDigits: 1 }) })}
                  >
                    <Icon name="star" size={18} color={t.colors.warning} />
                    <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
                      {tx('detail.rating', { rating: formatNumber(place.rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
                    </Text>
                    {place.userRatingCount != null ? (
                      <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                        {tx('detail.ratingCount', { count: place.userRatingCount })}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('detail.noRating')}</Text>
                )}
                {reviews.length > 0 ? (
                  <View style={{ gap: t.spacing.sm }}>
                    <Text style={[t.typography.overline, { color: t.colors.textMuted }]}>{tx('detail.reviewsTitle')}</Text>
                    {reviews.map((r) => (
                      <GoogleReview key={r.name} review={r} />
                    ))}
                  </View>
                ) : null}
                {mapsUrl ? (
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={tx('detail.openInMapsA11y', { name: item.name })}
                    onPress={() => void Linking.openURL(mapsUrl)}
                    hitSlop={8}
                    style={[styles.headRow, { gap: t.spacing.xs, minHeight: 44 }]}
                  >
                    <Icon name="external-link" size={16} color={t.colors.primaryInk} />
                    <Text style={[t.typography.small, { color: t.colors.primaryInk, fontWeight: '600' }]}>
                      {tx('detail.openInMaps')}
                    </Text>
                  </Pressable>
                ) : null}
                <PoweredByGoogle />
              </>
            ) : null}
          </View>

          {item.wiki?.extract ? (
            <Text style={[t.typography.small, { color: t.colors.text }]}>{item.wiki.extract}</Text>
          ) : null}

          {/* Add to trip */}
          {canEdit ? (
            <View style={{ gap: t.spacing.sm }}>
              <Text style={[t.typography.overline, { color: t.colors.textMuted }]}>{tx('detail.addTo')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
                <TargetChip label={tx('detail.ideas')} active={target === null} onPress={() => setTarget(null)} />
                {Array.from({ length: dayCount }, (_, d) => (
                  <TargetChip
                    key={d}
                    label={tx('detail.day', { n: d + 1 })}
                    active={target === d}
                    onPress={() => setTarget(d)}
                  />
                ))}
              </ScrollView>
              {outcome?.kind === 'added' ? (
                <View
                  style={[styles.headRow, { gap: t.spacing.sm, padding: t.spacing.md, borderRadius: t.radius.md, backgroundColor: t.colors.successLight }]}
                  accessibilityLiveRegion="polite"
                  aria-live="polite"
                >
                  <Icon name="circle-check" size={18} color={t.colors.text} />
                  <View style={{ flex: 1 }}>
                    <Text style={[t.typography.small, { color: t.colors.text, fontWeight: '600' }]}>{addedMessage(outcome)}</Text>
                    {outcome.result.matchedName && outcome.result.matchedName !== outcome.name ? (
                      <Text style={[t.typography.small, { color: t.colors.text }]}>
                        {tx('detail.matchedAs', { name: outcome.result.matchedName })}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : null}
              {outcome?.kind === 'error' ? (
                <Text
                  style={[t.typography.small, { color: t.colors.danger }]}
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  {tx(outcome.key)}
                </Text>
              ) : null}
              <Button
                label={alreadyAdded ? tx('detail.close') : tx('detail.add')}
                onPress={alreadyAdded ? onClose : onAdd}
                loading={add.isPending}
                disabled={add.isPending || match.isLoading || matchErrorKey === 'addError.no_match'}
                leftIcon={alreadyAdded ? undefined : <Icon name="plus" size={18} color={t.colors.primaryText} />}
              />
            </View>
          ) : (
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('detail.viewOnly')}</Text>
          )}
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}

function TargetChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active, selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          paddingHorizontal: t.spacing.md,
          borderRadius: t.radius.pill,
          backgroundColor: active ? t.colors.primary : t.colors.bgMuted,
        },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={[t.typography.caption, { color: active ? t.colors.primaryText : t.colors.text, fontWeight: active ? '700' : '500' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function GoogleReview({ review }: { review: PlaceReview }) {
  const t = useTheme();
  const { t: tx } = useT(['discover']);
  const author = review.authorAttribution.displayName;
  const authorUrl = safeHttpUrl(review.authorAttribution.uri);
  const rating = formatNumber(review.rating, { maximumFractionDigits: 1 });
  return (
    <View
      style={[styles.review, { gap: 4, padding: t.spacing.md, borderRadius: t.radius.md, backgroundColor: t.colors.bgMuted }]}
      accessible
      accessibilityLabel={tx('detail.reviewA11y', { name: author, rating })}
    >
      <View style={[styles.headRow, { gap: t.spacing.xs }]}>
        <Icon name="star" size={14} color={t.colors.warning} />
        <Text style={[t.typography.small, { color: t.colors.text, fontWeight: '700' }]}>{rating}</Text>
        {/* Google ToS: the author's name links to their profile. */}
        <Text
          style={[t.typography.small, { color: t.colors.text, textDecorationLine: authorUrl ? 'underline' : 'none' }]}
          onPress={authorUrl ? () => void Linking.openURL(authorUrl) : undefined}
          numberOfLines={1}
        >
          {author}
        </Text>
        <Text style={[t.typography.small, { color: t.colors.textMuted }]} numberOfLines={1}>
          · {review.relativePublishTimeDescription}
        </Text>
      </View>
      {review.text?.text ? (
        <Text style={[t.typography.small, { color: t.colors.text }]} numberOfLines={5}>
          {review.text.text}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 1 },
  headRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 40, justifyContent: 'center' },
  review: {},
});
