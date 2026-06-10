/**
 * PlaceCommentsSheet — per-place collaborator comment thread
 * (v2 Phase N1 step 1.7 — core-loop leg 2: "see reviews / comments").
 *
 * Opens from the 💬 chip on a PlaceRow. BottomSheet pattern (platform-split
 * component: modal sheet on native, centered dialog on web with Esc + focus
 * return). Thread is a flat list, oldest → newest (chat order), with an input
 * row to append and author-only soft delete.
 *
 * Server state: useTripPlaceComments(place.id) — optimistic add/delete and
 * rollback are handled inside the hooks (src/api/trip-place-comments.ts).
 *
 * Author labels: comments carry only `author_id`. We resolve display names
 * client-side, best-effort:
 *   - me                          → "You"
 *   - trip owner                  → "Trip owner"
 *   - accepted collaborator       → email prefix (from useTripCollaborators)
 *   - anyone else / RLS-hidden    → "Collaborator"
 * The collaborator list read may be owner-gated by RLS; on error we silently
 * fall back — labels degrade, the thread never breaks.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet, Button, Heading } from '@/components';
import { useTheme } from '@/theme';
import { confirmDestructive } from '@/lib/confirm';
import type { TripPlace, Uuid } from '@/api';
import {
  useCreateTripPlaceComment,
  useDeleteTripPlaceComment,
  useTripPlaceComments,
  type TripPlaceComment,
} from '@/api';
import { useTripCollaborators } from '@/api/trip-collaborators';
import { useSession } from '@/api/auth';

const MAX_COMMENT_LENGTH = 2000;

export interface PlaceCommentsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The place whose thread is shown; null = sheet closed / nothing selected. */
  place: TripPlace | null;
  tripId: Uuid;
  /** trips.user_id — used for the "Trip owner" author label. */
  tripOwnerId: Uuid;
}

export function PlaceCommentsSheet({
  visible,
  onClose,
  place,
  tripId,
  tripOwnerId,
}: PlaceCommentsSheetProps) {
  const t = useTheme();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  const { data: comments = [], isLoading } = useTripPlaceComments(place?.id);
  // Best-effort author resolution; errors are ignored (RLS may hide the
  // list from non-owners) — see module header.
  const { data: collaborators = [] } = useTripCollaborators(visible ? tripId : undefined);
  const createComment = useCreateTripPlaceComment();
  const deleteComment = useDeleteTripPlaceComment();

  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  // Reset the draft whenever the sheet targets a different place.
  useEffect(() => {
    setDraft('');
  }, [place?.id]);

  if (!place) return null;

  function authorLabel(authorId: Uuid): string {
    if (authorId === currentUserId) return 'You';
    const collab = collaborators.find((c) => c.user_id === authorId);
    if (collab) return collab.invitee_email.split('@')[0] ?? 'Collaborator';
    if (authorId === tripOwnerId) return 'Trip owner';
    return 'Collaborator';
  }

  function handleSend() {
    const body = draft.trim();
    if (!body || !place) return;
    // Optimistic append happens in the hook's onMutate — clear immediately.
    createComment.mutate({ tripId, tripPlaceId: place.id, body });
    setDraft('');
  }

  async function handleDelete(comment: TripPlaceComment) {
    if (!place) return;
    const confirmed = await confirmDestructive({
      title: 'Delete comment?',
      message: 'Your comment will be removed from the thread.',
      confirmLabel: 'Delete',
    });
    if (confirmed) {
      deleteComment.mutate({
        commentId: comment.id,
        tripPlaceId: place.id,
        tripId,
      });
    }
  }

  const placeTitle = place.user_title ?? 'this place';
  const remaining = MAX_COMMENT_LENGTH - draft.length;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel={`Comments on ${placeTitle}`}
    >
      <View style={{ gap: t.spacing.md }}>
        <Heading level={3}>{`💬 ${placeTitle}`}</Heading>

        {/* ── Thread (oldest first, newest at the bottom) ─────────────────── */}
        {isLoading ? (
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            Loading comments…
          </Text>
        ) : comments.length === 0 ? (
          <Text
            style={[t.typography.body, { color: t.colors.textMuted }]}
            accessibilityLabel="No comments yet. Start the discussion — is this worth the time?"
          >
            Start the discussion — is this worth the time?
          </Text>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.thread}
            contentContainerStyle={{ gap: t.spacing.sm }}
            keyboardShouldPersistTaps="handled"
            // Keep the newest comment in view as the thread grows.
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {comments.map((comment) => {
              const mine = comment.author_id === currentUserId;
              return (
                <View
                  key={comment.id}
                  style={[
                    styles.commentRow,
                    {
                      backgroundColor: t.colors.bgElevated,
                      borderColor: t.colors.border,
                      borderRadius: t.radius.md,
                      padding: t.spacing.sm,
                    },
                  ]}
                  accessible
                  accessibilityLabel={`${authorLabel(comment.author_id)} commented: ${comment.body}`}
                >
                  <View style={styles.commentMeta}>
                    <Text
                      style={[
                        t.typography.small,
                        { color: mine ? t.colors.primary : t.colors.textMuted, fontWeight: '600' },
                      ]}
                    >
                      {authorLabel(comment.author_id)}
                    </Text>
                    <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                      {formatCommentTime(comment.created_at)}
                    </Text>
                  </View>
                  <Text style={[t.typography.caption, { color: t.colors.text }]}>
                    {comment.body}
                  </Text>
                  {mine ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Delete your comment"
                      onPress={() => handleDelete(comment)}
                      hitSlop={6}
                      style={{ alignSelf: 'flex-end' }}
                    >
                      <Text style={[t.typography.small, { color: t.colors.danger }]}>Delete</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        )}

        {createComment.isError ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[t.typography.small, { color: t.colors.danger }]}
          >
            {"Couldn't post your comment — check your connection and try again."}
          </Text>
        ) : null}

        {/* ── Composer ─────────────────────────────────────────────────────── */}
        <View style={[styles.composerRow, { gap: t.spacing.sm }]}>
          <TextInput
            multiline
            value={draft}
            onChangeText={setDraft}
            maxLength={MAX_COMMENT_LENGTH}
            placeholder="Add a comment…"
            placeholderTextColor={t.colors.textMuted}
            accessibilityLabel={`Write a comment about ${placeTitle}`}
            style={[
              styles.composerInput,
              t.typography.caption,
              {
                borderColor: t.colors.border,
                borderRadius: t.radius.md,
                backgroundColor: t.colors.bgElevated,
                color: t.colors.text,
              },
            ]}
          />
          <Button
            label="Send"
            fullWidth={false}
            onPress={handleSend}
            disabled={draft.trim().length === 0}
            accessibilityLabel={`Post comment about ${placeTitle}`}
          />
        </View>
        {remaining < 200 ? (
          <Text style={[t.typography.small, { color: t.colors.textMuted, alignSelf: 'flex-end' }]}>
            {remaining} characters left
          </Text>
        ) : null}

        {/* Explicit close affordance (1.8) — backdrop tap + Esc also work. */}
        <Button variant="ghost" label="Close" onPress={onClose} />
      </View>
    </BottomSheet>
  );
}

/** Compact "Jun 10, 14:32" stamp; falls back to the raw ISO date on failure. */
function formatCommentTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  try {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

const styles = StyleSheet.create({
  // Bounded thread height so the composer + close button stay reachable
  // inside the sheet (native sheet caps at 80% viewport).
  thread: { maxHeight: 300 },
  commentRow: { borderWidth: 1, gap: 4 },
  commentMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end' },
  composerInput: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 44,
    maxHeight: 120,
    textAlignVertical: 'top',
  },
});
