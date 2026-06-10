/**
 * ImportPlacesSheet — paste/upload a list of place names into the Ideas
 * bucket (v2 Phase N4 step 4.3).
 *
 * Flow (one sheet, staged):
 *   input  → multiline paste box ("one place per line"), optional destination
 *            (improves grounding bias), and — web only — a Takeout-CSV picker
 *            that fills the same textarea (CsvImportButton). The batch is
 *            normalized client-side to ≤30 names (parseImportNames; overflow
 *            says "first 30 this batch").
 *   adding → useGroundPlaces (LLM-free `ground` action, budgeted at 100
 *            matched names/day — NOT the 10-runs AI quota) resolves names,
 *            then each resolved place is created into IDEAS via the normal
 *            useCreateTripPlace ("Adding i of n…"). No day move — Ideas IS
 *            day_index null. Places already in the trip are skipped, not
 *            duplicated.
 *   done   → honest summary: added (canonical Google names, which exposes
 *            wrong groundings), already-in-trip skips, insert failures, and
 *            the amber unresolved card. "Powered by Google" (ToS rule 4).
 *
 * Idempotency: one key per (names, destination) batch — retrying a timeout
 * replays the stored grounding for free (same contract as the other AI
 * sheets). quota_exceeded (429) renders the "Daily import limit reached
 * (100 places/day)" card.
 */
import { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  useCreateTripPlace,
  useGroundPlaces,
  type GroundPlacesResult,
  type TripPlace,
  type Uuid,
} from '@/api';
import { useTheme } from '@/theme';
import { BottomSheet, Button, Heading, PoweredByGoogle, StatusPill, TextField } from '@/components';
import { AiErrorNotice, PromptField } from '@/components/ai-plan';
import { MAX_IMPORT_BATCH, parseImportNames } from '@/lib/importParse';
import { UnresolvedCard } from './UnresolvedCard';
import { CsvImportButton } from './CsvImportButton';
import { keyForIntent, type IntentKey } from './makeIdempotencyKey';

export interface ImportPlacesSheetProps {
  visible: boolean;
  onClose: () => void;
  tripId: Uuid;
  /** Current trip places — used to skip imports already in the trip. */
  places: TripPlace[];
}

type Stage = 'input' | 'adding' | 'done';

interface ImportOutcome {
  /** Canonical Google names that landed in Ideas. */
  created: string[];
  /** Resolved fine, but already in this trip — skipped, not duplicated. */
  skippedExisting: string[];
  /** Resolved fine, but the insert failed. */
  createFailures: string[];
  /** Input names Google couldn't match. */
  unresolved: string[];
}

export function ImportPlacesSheet({ visible, onClose, tripId, places }: ImportPlacesSheetProps) {
  const t = useTheme();
  const ground = useGroundPlaces();
  const { mutateAsync: createPlaceAsync } = useCreateTripPlace();

  const [stage, setStage] = useState<Stage>('input');
  const [text, setText] = useState('');
  const [destination, setDestination] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  /** CSV pick feedback ("32 places loaded…" / "No Title column…"). */
  const [csvNotice, setCsvNotice] = useState<{ tone: 'info' | 'error'; message: string } | null>(
    null,
  );
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const intentRef = useRef<IntentKey | null>(null);
  // Re-entrancy guard for the sequential create loop (double-submit safety).
  const addingRef = useRef(false);

  const parsed = useMemo(() => parseImportNames(text), [text]);
  const existingPlaceIds = useMemo(
    () => new Set(places.map((p) => p.google_place_id)),
    [places],
  );

  // ── ground → create into Ideas ─────────────────────────────────────────
  const addAll = async (res: GroundPlacesResult) => {
    if (addingRef.current) return;
    addingRef.current = true;
    setStage('adding');
    const created: string[] = [];
    const skippedExisting: string[] = [];
    const createFailures: string[] = [];
    const fresh = res.resolved.filter((p) => {
      if (existingPlaceIds.has(p.googlePlaceId)) {
        skippedExisting.push(p.name);
        return false;
      }
      return true;
    });
    setProgress({ done: 0, total: fresh.length });
    for (const [i, place] of fresh.entries()) {
      try {
        // No day move: Ideas = day_index null, which is exactly how
        // useCreateTripPlace inserts (visit duration defaults to 60).
        await createPlaceAsync({
          trip_id: tripId,
          google_place_id: place.googlePlaceId,
          user_title: place.name,
          lat: place.lat,
          lng: place.lng,
        });
        created.push(place.name);
      } catch (err) {
        console.warn(`[ImportPlacesSheet] failed to add "${place.name}"`, err);
        createFailures.push(place.name);
      }
      setProgress({ done: i + 1, total: fresh.length });
    }
    setOutcome({ created, skippedExisting, createFailures, unresolved: res.unresolved });
    setStage('done');
    addingRef.current = false;
  };

  const handleImport = () => {
    if (parsed.names.length === 0) {
      setInputError('Paste at least one place name — one per line.');
      return;
    }
    setInputError(null);
    const signature = `${parsed.names.join('␟')}|${destination.trim()}`;
    intentRef.current = keyForIntent(intentRef.current, signature);
    ground.mutate(
      {
        names: parsed.names,
        destination: destination.trim() || undefined,
        idempotencyKey: intentRef.current.key,
      },
      { onSuccess: (res) => void addAll(res) },
    );
  };

  /** Back to a fresh paste box (destination kept — likely the same trip). */
  const resetForMore = () => {
    ground.reset();
    setText('');
    setCsvNotice(null);
    setOutcome(null);
    setProgress({ done: 0, total: 0 });
    setStage('input');
  };

  const handleCsvNames = (names: string[]) => {
    setText((prev) => {
      const merged = prev.trim().length > 0 ? `${prev.trim()}\n${names.join('\n')}` : names.join('\n');
      return merged;
    });
    setCsvNotice({
      tone: 'info',
      message:
        names.length > MAX_IMPORT_BATCH
          ? `${names.length} places loaded from the CSV — the first ${MAX_IMPORT_BATCH} import this batch; run Import again for the rest.`
          : `${names.length} ${names.length === 1 ? 'place' : 'places'} loaded from the CSV — review below, then import.`,
    });
  };

  // Closing is blocked only while rows are being written.
  const handleClose = () => {
    if (stage === 'adding') return;
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={handleClose} accessibilityLabel="Import places into Ideas">
      {/* ── Stage: input ─────────────────────────────────────────────────── */}
      {stage === 'input' ? (
        <View style={{ gap: t.spacing.md }}>
          <View style={{ gap: t.spacing.xs }}>
            <Heading level={2}>Import places</Heading>
            <Text style={[t.typography.caption, { color: t.colors.textMuted, lineHeight: 18 }]}>
              They'll land in your Ideas — schedule them onto days whenever you like.
            </Text>
          </View>

          <PromptField
            label="Your list"
            value={text}
            onChangeText={(v) => {
              setText(v);
              if (inputError) setInputError(null);
            }}
            placeholder={'One place per line — or paste a list'}
            minHeight={120}
            error={inputError}
            hint={
              parsed.names.length > 0
                ? `${parsed.names.length} ${parsed.names.length === 1 ? 'place' : 'places'} ready` +
                  (parsed.skipped > 0 ? ` · ${parsed.skipped} duplicate/short lines skipped` : '')
                : undefined
            }
          />

          {parsed.truncated ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[t.typography.small, { color: t.colors.textMuted }]}
            >
              More than {MAX_IMPORT_BATCH} places — the first {MAX_IMPORT_BATCH} import this
              batch. Run Import again for the rest.
            </Text>
          ) : null}

          {/* Web-only Takeout CSV picker (renders nothing on native). */}
          <CsvImportButton
            onNames={handleCsvNames}
            onError={(message) => setCsvNotice({ tone: 'error', message })}
            disabled={ground.isPending}
          />
          {csvNotice ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[
                t.typography.small,
                { color: csvNotice.tone === 'error' ? t.colors.danger : t.colors.textMuted },
              ]}
            >
              {csvNotice.message}
            </Text>
          ) : null}

          <TextField
            label="Destination (optional — improves matching)"
            value={destination}
            onChangeText={setDestination}
            placeholder="e.g. Paris"
            maxLength={120}
          />

          {ground.error ? (
            <AiErrorNotice
              error={ground.error}
              dailyLimit={100}
              onRetry={handleImport}
              retryPending={ground.isPending}
              quotaTitle="Daily import limit reached (100 places/day)"
              quotaBody="Imports can match up to 100 places per day, shared with AI grounding. Nothing was imported — your list is still here; try again tomorrow or with a smaller batch."
              setupDocPath="supabase/functions/ai-edit/README.md"
            />
          ) : null}

          <Button
            label={
              parsed.names.length > 0
                ? `Import ${parsed.names.length} ${parsed.names.length === 1 ? 'place' : 'places'}`
                : 'Import'
            }
            onPress={handleImport}
            loading={ground.isPending}
            disabled={parsed.names.length === 0}
            accessibilityLabel={`Import ${parsed.names.length} places into your Ideas`}
          />
          {ground.isPending ? (
            <View style={styles.centerRow}>
              <StatusPill loading label="Matching your places…" />
            </View>
          ) : null}
          <Button variant="ghost" label="Cancel" onPress={handleClose} />
        </View>
      ) : null}

      {/* ── Stage: adding (sequential inserts into Ideas) ────────────────── */}
      {stage === 'adding' ? (
        <View style={[styles.progressBlock, { gap: t.spacing.md, padding: t.spacing.lg }]}>
          <StatusPill loading label="Adding to your Ideas" />
          <Text
            accessibilityLiveRegion="polite"
            style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center' }]}
          >
            {progress.total === 0
              ? 'Finishing up…'
              : `Adding ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`}
          </Text>
        </View>
      ) : null}

      {/* ── Stage: done (honest summary) ─────────────────────────────────── */}
      {stage === 'done' && outcome ? (
        <View style={{ gap: t.spacing.md }}>
          <View style={styles.centerRow}>
            <StatusPill
              tone={outcome.created.length > 0 ? 'success' : 'info'}
              label={
                outcome.created.length > 0
                  ? `${outcome.created.length} added to Ideas`
                  : 'Nothing new to add'
              }
            />
          </View>

          <ScrollView style={styles.resultScroll} contentContainerStyle={{ gap: t.spacing.sm }}>
            {outcome.created.length > 0 ? (
              <View style={{ gap: t.spacing.xs }}>
                <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '700' }]}>
                  Found ({outcome.created.length})
                </Text>
                {outcome.created.map((name) => (
                  <Text key={name} style={[t.typography.caption, { color: t.colors.text }]}>
                    • {name}
                  </Text>
                ))}
                <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                  Names shown as Google matched them — remove any wrong match from Ideas.
                </Text>
              </View>
            ) : null}

            {outcome.skippedExisting.length > 0 ? (
              <View style={{ gap: t.spacing.xs }}>
                <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '700' }]}>
                  Already in this trip — skipped ({outcome.skippedExisting.length})
                </Text>
                {outcome.skippedExisting.map((name) => (
                  <Text key={name} style={[t.typography.caption, { color: t.colors.textMuted }]}>
                    • {name}
                  </Text>
                ))}
              </View>
            ) : null}

            {outcome.createFailures.length > 0 ? (
              <View
                accessibilityRole="alert"
                style={{
                  backgroundColor: t.colors.dangerLight,
                  borderRadius: t.radius.md,
                  padding: t.spacing.md,
                  gap: t.spacing.xs,
                }}
              >
                <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
                  {outcome.createFailures.length} couldn't be added
                </Text>
                {outcome.createFailures.map((name) => (
                  <Text key={name} style={[t.typography.caption, { color: t.colors.textMuted }]}>
                    • {name}
                  </Text>
                ))}
                <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                  Try importing these again, or add them by hand.
                </Text>
              </View>
            ) : null}

            <UnresolvedCard
              names={outcome.unresolved}
              title={`We couldn't find ${outcome.unresolved.length === 1 ? 'this one' : 'these'}`}
              hint="Check the spelling or add a destination, then import them again."
            />

            {/* Resolved names are Google-grounded place data (ToS rule 4). */}
            {outcome.created.length > 0 || outcome.skippedExisting.length > 0 ? (
              <PoweredByGoogle />
            ) : null}
          </ScrollView>

          <Button label="Done" onPress={handleClose} />
          <Button variant="ghost" label="Import more" onPress={resetForMore} />
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  centerRow: { alignItems: 'center' },
  progressBlock: { alignItems: 'center' },
  // Bounded so long result lists scroll inside the sheet on both platforms.
  resultScroll: { maxHeight: 320 },
});
