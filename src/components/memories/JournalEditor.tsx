/**
 * JournalEditor — the signed-in user's journal for ONE trip day (M5 Y3.1).
 *
 * Edits the day's primary own entry (useJournalEntry), or creates one on the
 * first save. Saves on the Save button and on blur when the text changed.
 * Offline-safe (Tier-1). The share switch applies right away to an existing
 * entry; before the first save it sets the visibility the entry is created
 * with. Delete is a tombstone with the global undo toast.
 *
 * `canWrite=false` (the user left the trip): the entry stays readable, and
 * the user can still unshare or delete it (the server allows both), but not
 * edit the text.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';
import { confirmDestructive } from '@/lib/confirm';
import {
  useDeleteMemory,
  useJournalEntry,
  useSaveJournalEntry,
  useSetMemoryVisibility,
} from '@/api/memories';
import type { MemoryVisibility } from '@/api/memories.types';
import { VisibilityToggle } from './VisibilityToggle';
import { errorInfoOf, memoryErrorKey, type MemoryErrorKey } from './memoryErrors';

export interface JournalEditorProps {
  tripId: string;
  dayIndex: number;
  canWrite: boolean;
  autoFocus?: boolean;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved';

export function JournalEditor({ tripId, dayIndex, canWrite, autoFocus = false }: JournalEditorProps) {
  const t = useTheme();
  const { t: tx } = useT(['memories', 'common']);
  const { data: entry, isLoading } = useJournalEntry(tripId, dayIndex);
  const save = useSaveJournalEntry();
  const setVisibility = useSetMemoryVisibility();
  const del = useDeleteMemory();

  const [draft, setDraft] = useState(entry?.body ?? '');
  const [state, setState] = useState<SaveState>('idle');
  const [pendingVisibility, setPendingVisibility] = useState<MemoryVisibility>('only_me');
  const [errorKey, setErrorKey] = useState<MemoryErrorKey | null>(null);
  const entryIdRef = useRef<string | null>(entry?.id ?? null);
  // Blur + Save press fire back to back: one save at a time (no duplicate create).
  const savingRef = useRef(false);

  // Adopt the stored text when it arrives (or changes on another device)
  // unless the user is mid-edit.
  const storedBody = entry?.body ?? '';
  useEffect(() => {
    entryIdRef.current = entry?.id ?? null;
    if (state === 'dirty' || state === 'saving') return;
    setDraft(storedBody);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the stored row changes
  }, [entry?.id, storedBody]);

  const visibility: MemoryVisibility = entry?.visibility ?? pendingVisibility;
  const dirty = draft !== storedBody;

  const doSave = async () => {
    if (!canWrite || !dirty || savingRef.current) return;
    savingRef.current = true;
    setState('saving');
    setErrorKey(null);
    try {
      const input: Parameters<typeof save.mutateAsync>[0] = { tripId, dayIndex, body: draft };
      if (entryIdRef.current) input.id = entryIdRef.current;
      else input.visibility = pendingVisibility;
      const id = await save.mutateAsync(input);
      entryIdRef.current = id;
      setState('saved');
    } catch (e) {
      setState('dirty');
      setErrorKey(memoryErrorKey(errorInfoOf(e)));
    } finally {
      savingRef.current = false;
    }
  };

  const onVisibility = (next: MemoryVisibility) => {
    setErrorKey(null);
    if (!entry) {
      setPendingVisibility(next);
      return;
    }
    setVisibility.mutate(
      { tripId, items: [{ kind: 'journal', id: entry.id }], visibility: next },
      { onError: (e) => setErrorKey(memoryErrorKey(errorInfoOf(e))) },
    );
  };

  const onDelete = async () => {
    if (!entry) return;
    const ok = await confirmDestructive({
      title: tx('journal.deleteTitle'),
      message: tx('journal.deleteBody'),
      confirmLabel: tx('actions.delete'),
      cancelLabel: tx('common:actions.cancel'),
    });
    if (!ok) return;
    del.mutate(
      { tripId, kind: 'journal', id: entry.id },
      {
        onSuccess: () => {
          setDraft('');
          setState('idle');
        },
        onError: (e) => setErrorKey(memoryErrorKey(errorInfoOf(e))),
      },
    );
  };

  const status =
    state === 'saving'
      ? tx('journal.saving')
      : dirty
        ? tx('journal.unsaved')
        : state === 'saved'
          ? tx('journal.saved')
          : null;

  return (
    <View style={{ gap: t.spacing.sm }}>
      <TextInput
        value={draft}
        onChangeText={(text) => {
          setDraft(text);
          setState('dirty');
        }}
        onBlur={() => void doSave()}
        editable={canWrite && !isLoading}
        multiline
        autoFocus={autoFocus}
        maxLength={20000}
        placeholder={tx('journal.placeholder')}
        placeholderTextColor={t.colors.textMuted}
        accessibilityLabel={tx('journal.label', { day: dayIndex + 1 })}
        style={[
          t.typography.body,
          styles.input,
          {
            color: t.colors.text,
            backgroundColor: t.colors.bg,
            borderColor: t.colors.border,
            borderRadius: t.radius.md,
            padding: t.spacing.md,
          },
        ]}
      />
      <View style={[styles.footer, { gap: t.spacing.sm }]}>
        {status ? (
          <Text
            style={[t.typography.small, { color: t.colors.textMuted, flex: 1 }]}
            accessibilityLiveRegion="polite"
          >
            {status}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {entry ? (
          <Button variant="ghost" label={tx('actions.delete')} onPress={() => void onDelete()} />
        ) : null}
        {canWrite ? (
          <Button
            variant="secondary"
            label={tx('actions.save')}
            onPress={() => void doSave()}
            disabled={!dirty}
            loading={state === 'saving'}
          />
        ) : null}
      </View>
      {entry || canWrite ? (
        <VisibilityToggle visibility={visibility} onChange={onVisibility} itemLabel={tx('items.journal')} />
      ) : null}
      {errorKey ? (
        <Text style={[t.typography.small, { color: t.colors.dangerText }]} accessibilityLiveRegion="polite">
          {tx(errorKey)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 110, borderWidth: 1, textAlignVertical: 'top' },
  footer: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
});
