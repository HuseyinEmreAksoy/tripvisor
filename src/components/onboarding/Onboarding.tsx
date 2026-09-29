/**
 * Onboarding — the 3-card first-run intro (v2 M4 X3.2).
 *
 * Rendered by `app/index.tsx` for a signed-out first visit only (see
 * onboardingFlag.ts for the gate). Swipe between cards on a phone, or use the
 * Next / Back buttons (keyboard + screen reader). "Skip" is always visible, so
 * the intro can never trap anyone.
 *
 * Art reuses the bundled brand illustrations (assets/images/empty-*.png).
 *
 * M5 Y3.4: a 4th card lets the visitor pick interests (Discover's starting
 * chips). Picks wait in local storage until the account exists
 * (src/components/discover/pendingInterests.ts). Its copy lives in
 * `discover:onboarding.*`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useT } from '@/i18n';
import { InterestChips } from '@/components/discover/InterestChips';
import { savePendingInterests } from '@/components/discover/pendingInterests';
import type { Interest } from '@/components/discover/discoverModel';

export interface OnboardingCard {
  key: 'ai' | 'route' | 'offline' | 'interests';
  art: number;
}

/** Copy lives in `onboarding:cards.<key>.{kicker,title,body}` (en + tr); the interests card uses `discover:onboarding.*`. */
export const ONBOARDING_CARDS: readonly OnboardingCard[] = [
  { key: 'ai', art: require('../../../assets/images/empty-search.png') },
  { key: 'route', art: require('../../../assets/images/empty-places.png') },
  { key: 'offline', art: require('../../../assets/images/empty-trips.png') },
  { key: 'interests', art: require('../../../assets/images/onboarding-interests.png') },
];

export type OnboardingExit = 'signup' | 'login';

export interface OnboardingProps {
  onFinish: (exit: OnboardingExit) => void;
}

export function Onboarding({ onFinish }: OnboardingProps) {
  const t = useTheme();
  const { t: tx } = useT(['onboarding', 'common', 'discover']);
  const total = ONBOARDING_CARDS.length;
  const kicker = (card: OnboardingCard) =>
    card.key === 'interests' ? tx('discover:onboarding.kicker') : tx(`cards.${card.key}.kicker`);
  const title = (card: OnboardingCard) =>
    card.key === 'interests' ? tx('discover:onboarding.title') : tx(`cards.${card.key}.title`);
  const body = (card: OnboardingCard) =>
    card.key === 'interests' ? tx('discover:onboarding.body') : tx(`cards.${card.key}.body`);
  const [interests, setInterests] = useState<Interest[]>([]);
  const onInterests = (next: Interest[]) => {
    setInterests(next);
    void savePendingInterests(next);
  };
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<ScrollView | null>(null);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const last = ONBOARDING_CARDS.length - 1;

  // True while a Next/Back/dot-driven animated scroll is in flight. Its
  // intermediate onScroll offsets would otherwise round to the cards it
  // passes through and make the dots flicker (e.g. 0 → 1 → 2 on a jump).
  // Cleared on momentum end, when the user starts dragging, or by a timeout
  // (web and scrollTo don't reliably emit momentum events).
  const programmaticScroll = useRef(false);
  const programmaticTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearProgrammatic = useCallback(() => {
    programmaticScroll.current = false;
    if (programmaticTimer.current) {
      clearTimeout(programmaticTimer.current);
      programmaticTimer.current = null;
    }
  }, []);

  useEffect(() => clearProgrammatic, [clearProgrammatic]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(last, next));
      setIndex(clamped);
      if (width <= 0) return;
      const animated = !reducedMotion;
      if (animated) {
        clearProgrammatic();
        programmaticScroll.current = true;
        programmaticTimer.current = setTimeout(clearProgrammatic, 700);
      }
      scrollRef.current?.scrollTo({ x: clamped * width, animated });
    },
    [last, width, reducedMotion, clearProgrammatic],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w !== width) {
      setWidth(w);
      // Keep the current card in view after a resize / rotation.
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ x: index * w, animated: false }));
    }
  };

  // onScroll (not onMomentumScrollEnd) so a touch swipe on mobile web, which
  // has no momentum events, also moves the dots and buttons along.
  const indexFromEvent = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    Math.max(0, Math.min(last, Math.round(e.nativeEvent.contentOffset.x / width)));

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0 || programmaticScroll.current) return;
    const next = indexFromEvent(e);
    if (next !== index) setIndex(next);
  };

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    clearProgrammatic();
    if (width <= 0) return;
    const next = indexFromEvent(e);
    if (next !== index) setIndex(next);
  };

  return (
    <Screen padded={false}>
      <View style={[styles.topBar, { paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm }]}>
        <Text style={[t.typography.overline, { color: t.colors.primary }]} accessibilityElementsHidden importantForAccessibility="no">
          Tripvisor
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tx('skipA11y')}
          onPress={() => onFinish('login')}
          hitSlop={12}
          style={({ pressed }) => [styles.skip, { padding: t.spacing.sm }, pressed && { opacity: 0.6 }]}
        >
          <Text style={[t.typography.bodyStrong, { color: t.colors.textMuted }]}>{tx('skip')}</Text>
        </Pressable>
      </View>

      <View style={styles.pager} onLayout={onLayout} testID="onboarding-pager">
        {width > 0 ? (
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            onScrollBeginDrag={clearProgrammatic}
            onMomentumScrollEnd={onMomentumScrollEnd}
            scrollEventThrottle={32}
          >
            {ONBOARDING_CARDS.map((card, i) => (
              <View
                key={card.key}
                style={[styles.page, { width, paddingHorizontal: t.spacing.xl }]}
                accessibilityElementsHidden={i !== index}
                importantForAccessibility={i === index ? 'auto' : 'no-hide-descendants'}
                aria-hidden={i !== index}
              >
                <View style={[styles.inner, { gap: t.spacing.md }]}>
                  <Image
                    source={card.art}
                    style={card.key === 'interests' ? styles.artSmall : styles.art}
                    contentFit="contain"
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    aria-hidden
                  />
                  <Text style={[t.typography.overline, { color: t.colors.accent }]}>
                    {tx('progress', { kicker: kicker(card), current: i + 1, total })}
                  </Text>
                  <Text
                    style={[t.typography.title, styles.center, { color: t.colors.text }]}
                    accessibilityRole="header"
                    aria-level={1}
                  >
                    {title(card)}
                  </Text>
                  <Text style={[t.typography.body, styles.center, { color: t.colors.textMuted }]}>
                    {body(card)}
                  </Text>
                  {card.key === 'interests' ? (
                    <View style={{ gap: t.spacing.sm, alignItems: 'center' }}>
                      <InterestChips value={interests} onChange={onInterests} centered />
                      {interests.length > 0 ? (
                        <Text style={[t.typography.small, { color: t.colors.textMuted }]} accessibilityLiveRegion="polite">
                          {tx('discover:onboarding.selected', { count: interests.length })}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <View style={[styles.footer, { padding: t.spacing.xl, gap: t.spacing.lg }]}>
        <View style={[styles.dots, { gap: t.spacing.sm }]}>
          {ONBOARDING_CARDS.map((card, i) => (
            <Pressable
              key={card.key}
              accessibilityRole="button"
              accessibilityLabel={tx('goToCard', { current: i + 1, total, kicker: kicker(card) })}
              accessibilityState={{ selected: i === index }}
              onPress={() => goTo(i)}
              hitSlop={10}
              style={[
                styles.dot,
                {
                  width: i === index ? 24 : 8,
                  backgroundColor: i === index ? t.colors.primary : t.colors.borderStrong,
                  borderRadius: t.radius.pill,
                },
              ]}
            />
          ))}
        </View>

        {index < last ? (
          <View style={[styles.row, { gap: t.spacing.md }]}>
            {index > 0 ? (
              <View style={styles.grow}>
                <Button variant="secondary" label={tx('common:actions.back')} onPress={() => goTo(index - 1)} />
              </View>
            ) : null}
            <View style={styles.grow}>
              <Button
                label={tx('common:actions.next')}
                onPress={() => goTo(index + 1)}
                accessibilityHint={tx('nextHint', { current: index + 2, total })}
              />
            </View>
          </View>
        ) : (
          <View style={{ gap: t.spacing.sm }}>
            <Button label={tx('createAccount')} onPress={() => onFinish('signup')} />
            <Button variant="ghost" label={tx('haveAccount')} onPress={() => onFinish('login')} />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skip: { minHeight: 44, justifyContent: 'center' },
  pager: { flex: 1 },
  page: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  inner: { width: '100%', maxWidth: 480, alignItems: 'center' },
  art: { width: '100%', maxWidth: 360, aspectRatio: 4 / 3 },
  artSmall: { width: '100%', maxWidth: 220, aspectRatio: 4 / 3 },
  center: { textAlign: 'center' },
  footer: { width: '100%', maxWidth: 520, alignSelf: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  dot: { height: 8 },
  row: { flexDirection: 'row' },
  grow: { flex: 1 },
});
