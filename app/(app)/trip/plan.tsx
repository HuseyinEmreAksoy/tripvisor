/**
 * /trip/plan — "Plan my trip with AI" (v2 Phase N1 step 1.3: placeholder).
 *
 * Reached from the HomeHero CTA on /trips. This build ships the shell only:
 * title, expectation-setting copy, and explicit back affordances (1.8).
 *
 * ── WAVE 3 MOUNT POINT (Phase N3, steps 3.4 + 3.5) ─────────────────────────
 * Replace the <PlaceholderBody /> below with the real flow:
 *   1. Prompt form (destination, days, vibe) → `ai-itinerary` Edge Function
 *      via a TanStack mutation hook in src/api/ (backend-specialist).
 *   2. Result lands as a DRAFT → draft-review screen (per-place keep/remove/
 *      swap + day reassign) → commit on accept → one-tap undo after apply.
 *   3. Quota-exhausted + partial-grounding states per plan-v2.md N3.
 * Routing contract: stay on /trip/plan for the form; push the created trip
 * (`/trip/[id]`) only after the user accepts the draft.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Static segment beats the dynamic sibling: /trip/plan resolves here, never
 * to /trip/[id] with id="plan" (same precedence /trip/new already relies on).
 */
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BackButton, Button, Heading, Screen } from '@/components';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';

const PREVIEW_POINTS = [
  '🗣️ Describe it — "5 relaxed days in Lisbon with great food"',
  '🤖 AI drafts a day-by-day plan with real places',
  '✏️ You review every stop — keep, swap, or remove before anything is saved',
] as const;

export default function PlanMyTrip() {
  const t = useTheme();
  const router = useRouter();
  const isDesktop = useBreakpoint() === 'desktop';

  // 1.8: never strand the user — back falls back to Home when there's no
  // history (e.g. direct URL entry on web).
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/trips');
  };

  return (
    <Screen padded={false}>
      <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
        <BackButton onPress={goBack} label="Home" />
      </View>

      <View
        style={[
          styles.body,
          {
            padding: t.spacing.xl,
            gap: t.spacing.lg,
            maxWidth: isDesktop ? 640 : undefined,
            alignSelf: isDesktop ? 'center' : 'stretch',
            width: '100%',
          },
        ]}
      >
        <Text
          style={styles.icon}
          accessibilityElementsHidden
          importantForAccessibility="no"
          aria-hidden
        >
          ✨
        </Text>
        <Heading level={1}>Plan my trip with AI</Heading>
        <Text
          style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center', lineHeight: 24 }]}
        >
          Describe your trip and AI will draft it — landing in this build. You'll
          get an editable day-by-day itinerary you can tweak place by place,
          never a locked plan.
        </Text>

        <View style={{ gap: t.spacing.sm, alignSelf: 'stretch' }}>
          {PREVIEW_POINTS.map((point) => (
            <View
              key={point}
              style={[
                styles.pointRow,
                {
                  backgroundColor: t.colors.bgElevated,
                  borderColor: t.colors.border,
                  borderRadius: t.radius.md,
                  padding: t.spacing.md,
                },
              ]}
            >
              <Text style={[t.typography.caption, { color: t.colors.text }]}>{point}</Text>
            </View>
          ))}
        </View>

        <Button variant="ghost" label="← Back to your trips" onPress={goBack} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 56,
    lineHeight: 64,
  },
  pointRow: {
    borderWidth: 1,
  },
});
