/**
 * DayStartTimeControl — editable per-day start time chip for the itinerary
 * timeline (v2 Phase N1 step 1.2).
 *
 * Collapsed: a small "🕘 Starts 09:00" chip in the day header. Tap to expand
 * into an inline editor: [−30m] [HH:MM input] [+30m] [Done].
 *
 * State contract (mirrors NotesEditors.tsx):
 *   - The EFFECTIVE value (`valueMinutes`) is owned by ItineraryTab, which
 *     derives it as `session override ?? trip_days.start_time ?? 09:00` and
 *     feeds the same number into computeDayTimeline — control and math can
 *     never disagree.
 *   - On commit this control (a) reports the new minutes up via
 *     `onChangeMinutes` so the timeline updates instantly, and (b) persists
 *     via the existing useUpdateTripDay upsert with a 500ms debounce.
 *
 * Persistence contract (v2 0020, shipped by backend-specialist in parallel):
 *   `trip_days.start_time` is a `time` column; the upsert accepts
 *   `start_time: "HH:MM"`. Until the api hook widens its schema, the field is
 *   typed via a local cast (see `// v2 0020` below) — DO NOT edit src/api
 *   from UI code. If the write errors at runtime (migration not applied yet)
 *   a non-blocking inline note appears and the computed timeline keeps
 *   working off the session value.
 *
 * NOTE on notes preservation: useUpdateTripDay's upsert always writes the
 * `notes` column, so we MUST thread the current notes through or a start-time
 * edit would wipe the day's notes. See `buildPatch()`.
 */
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/theme';
import { useDebouncedCallback } from '@/lib/hooks/useDebouncedCallback';
import { useUpdateTripDay, type TripDay, type UpdateTripDayInput } from '@/api';
import {
  formatClockTime,
  minutesToTimeValue,
  parseStartTime,
} from './computeDayTimeline';

const STEP_MINUTES = 30;
/** Keep start times within a single day: 00:00 .. 23:30. */
const MAX_START_MINUTES = 23 * 60 + 30;

export interface DayStartTimeControlProps {
  tripId: string;
  dayIndex: number;
  /** Existing trip_days row (null when the day has never been touched). */
  dayRecord: TripDay | null;
  /** Effective start minutes — owned by ItineraryTab (override ?? server ?? 540). */
  valueMinutes: number;
  /** Fires immediately on commit so the parent recomputes the timeline. */
  onChangeMinutes: (minutes: number) => void;
  /** Viewers see the chip read-only. */
  canEdit?: boolean;
}

export function DayStartTimeControl({
  tripId,
  dayIndex,
  dayRecord,
  valueMinutes,
  onChangeMinutes,
  canEdit = true,
}: DayStartTimeControlProps) {
  const t = useTheme();
  const updateDay = useUpdateTripDay();
  const [expanded, setExpanded] = useState(false);
  // Draft text only exists while the editor is open; committed values flow
  // through the parent-owned `valueMinutes` (no server data mirrored here).
  const [draftText, setDraftText] = useState<string | null>(null);
  const [invalidDraft, setInvalidDraft] = useState(false);

  // Debounced persistence: stepper taps coalesce into one upsert.
  const debouncedPersist = useDebouncedCallback((minutes: number) => {
    const patch = {
      trip_id: tripId,
      day_index: dayIndex,
      // Preserve existing notes — the upsert writes the notes column
      // unconditionally, so omitting this would null them out.
      notes: dayRecord?.notes ?? null,
      // v2 0020: start_time lands with migration 0020 + the widened api
      // schema (backend-specialist, in parallel). Cast keeps tsc strict
      // without touching src/api from UI code.
      start_time: minutesToTimeValue(minutes),
    } as UpdateTripDayInput & { start_time?: string };
    updateDay.mutate(patch);
  }, 500);

  function commit(minutes: number) {
    const clamped = Math.min(MAX_START_MINUTES, Math.max(0, minutes));
    setInvalidDraft(false);
    setDraftText(formatClockTime(clamped));
    onChangeMinutes(clamped); // timeline updates instantly
    debouncedPersist(clamped); // server catches up
  }

  function commitDraftText(text: string) {
    const parsed = parseStartTime(text, -1);
    if (parsed < 0) {
      setInvalidDraft(true);
      return;
    }
    commit(parsed);
  }

  const label = formatClockTime(valueMinutes);

  // ── Collapsed chip ─────────────────────────────────────────────────────────
  if (!expanded) {
    return (
      <Pressable
        accessibilityRole={canEdit ? 'button' : 'text'}
        accessibilityLabel={
          canEdit
            ? `Day ${dayIndex + 1} starts at ${label}. Tap to change the start time.`
            : `Day ${dayIndex + 1} starts at ${label}.`
        }
        disabled={!canEdit}
        onPress={() => {
          setDraftText(label);
          setInvalidDraft(false);
          setExpanded(true);
        }}
        // v2 M4 X2.3: 32pt chip + 6pt vertical slop = 44pt target.
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        style={({ pressed }) => [
          styles.chip,
          {
            backgroundColor: t.colors.cardBgSolid,
            borderColor: t.colors.border,
            borderRadius: t.radius.pill,
            paddingHorizontal: t.spacing.md,
            paddingVertical: t.spacing.xs,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '600' }]}>
          {'🕘 Starts '}
          {label}
        </Text>
      </Pressable>
    );
  }

  // ── Expanded inline editor ─────────────────────────────────────────────────
  return (
    <View style={{ gap: t.spacing.xs }}>
      <View style={[styles.editorRow, { gap: t.spacing.xs }]}>
        <StepButton
          label="−30m"
          accessibilityLabel={`Start Day ${dayIndex + 1} 30 minutes earlier`}
          onPress={() => commit(valueMinutes - STEP_MINUTES)}
        />
        <TextInput
          value={draftText ?? label}
          onChangeText={(text) => {
            setDraftText(text);
            setInvalidDraft(false);
          }}
          onBlur={() => commitDraftText(draftText ?? label)}
          onSubmitEditing={() => commitDraftText(draftText ?? label)}
          placeholder="09:00"
          placeholderTextColor={t.colors.textMuted}
          accessibilityLabel={`Start time for Day ${dayIndex + 1}, format hours colon minutes`}
          keyboardType={Platform.OS === 'web' ? undefined : 'numbers-and-punctuation'}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={5}
          style={[
            styles.timeInput,
            t.typography.caption,
            {
              borderColor: invalidDraft ? t.colors.danger : t.colors.border,
              borderRadius: t.radius.sm,
              backgroundColor: t.colors.bgElevated,
              color: t.colors.text,
            },
          ]}
        />
        <StepButton
          label="+30m"
          accessibilityLabel={`Start Day ${dayIndex + 1} 30 minutes later`}
          onPress={() => commit(valueMinutes + STEP_MINUTES)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Done editing Day ${dayIndex + 1} start time`}
          onPress={() => {
            commitDraftText(draftText ?? label);
            setExpanded(false);
          }}
          style={styles.doneBtn}
        >
          <Text style={[t.typography.caption, { color: t.colors.primary, fontWeight: '600' }]}>
            Done
          </Text>
        </Pressable>
      </View>

      {invalidDraft ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[t.typography.small, { color: t.colors.danger }]}
        >
          Use HH:MM, e.g. 09:30
        </Text>
      ) : null}

      {/* Non-blocking note when persistence fails (e.g. migration 0020 not
          applied yet). The session timeline keeps using the chosen time. */}
      {updateDay.isError ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[t.typography.small, { color: t.colors.warning }]}
        >
          {"Couldn't save the start time yet — times below use it for this session."}
        </Text>
      ) : null}
    </View>
  );
}

function StepButton({
  label,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.stepBtn,
        {
          backgroundColor: pressed ? t.colors.bgMuted : t.colors.bgElevated,
          borderColor: t.colors.border,
          borderRadius: t.radius.sm,
        },
      ]}
    >
      <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '600' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  editorRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  timeInput: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 64,
    minHeight: 36,
    textAlign: 'center',
  },
  // v2 M4 X2.3: ≥44pt targets for the inline editor on phones.
  doneBtn: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  stepBtn: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    minHeight: 36,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
