/**
 * InviteSheet — invite a collaborator by email + role, then hand the invite
 * link to the native share sheet (web: navigator.share → clipboard fallback).
 *
 * The invite link is only returned once, by the invite mutation, so the
 * success step leads with "Share invite link" — that's how the owner gets the
 * link to the person when email delivery fails or they prefer a messenger.
 */
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { SegmentedControl } from '@/components/SegmentedControl';
import { useTheme } from '@/theme';
import { copyToClipboard } from '@/lib/clipboard';
import { CollaboratorError, type useInviteCollaborator } from '@/api/trip-collaborators';
import type { TripCollaboratorRole } from '@/api/types';
import { useShareAction } from '@/components/share';
import { useT } from '@/i18n';
import { ROLE_COPY } from './collaboratorModel';

const ROLE_OPTIONS: Array<{ value: TripCollaboratorRole; label: string }> = [
  { value: 'viewer', label: ROLE_COPY.viewer.label },
  { value: 'editor', label: ROLE_COPY.editor.label },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `collab` namespace keys for invite failures (translated at render). */
export type InviteErrorKey =
  | 'invite.errors.emailRequired'
  | 'invite.errors.emailInvalid'
  | 'invite.errors.alreadyInvited'
  | 'invite.errors.rateLimited'
  | 'invite.errors.tripLimit'
  | 'invite.errors.unavailable'
  | 'invite.errors.notOwner'
  | 'invite.errors.generic';

export interface InviteError {
  key: InviteErrorKey;
  /**
   * True when the email itself is the problem, so the field turns red.
   * Quota, permission and server failures are about the invite, not what
   * was typed, so they show as a form-level alert instead.
   */
  field: boolean;
}

const INVITE_ERRORS: Readonly<Record<string, InviteError>> = {
  already_invited: { key: 'invite.errors.alreadyInvited', field: true },
  // Audit #14 quotas (429/503).
  invite_rate_limited: { key: 'invite.errors.rateLimited', field: false },
  trip_invite_limit: { key: 'invite.errors.tripLimit', field: false },
  quota_unavailable: { key: 'invite.errors.unavailable', field: false },
  not_owner: { key: 'invite.errors.notOwner', field: false },
};

const GENERIC_ERROR: InviteError = { key: 'invite.errors.generic', field: false };

/**
 * Map an invite failure to its inline error. Known `CollaboratorError` codes
 * get our copy. Anything else (network, 5xx) gets a generic line, because the
 * server's messages are English-only.
 */
export function inviteError(err: unknown): InviteError {
  if (err instanceof CollaboratorError) {
    const known = INVITE_ERRORS[err.code];
    if (known) return known;
  }
  return GENERIC_ERROR;
}

interface InviteResult {
  url: string;
  email: string;
  emailSent: boolean;
}

export interface InviteSheetProps {
  tripId: string;
  tripTitle: string;
  visible: boolean;
  onClose: () => void;
  inviteMutation: ReturnType<typeof useInviteCollaborator>;
}

export function InviteSheet({ tripId, tripTitle, visible, onClose, inviteMutation }: InviteSheetProps) {
  const t = useTheme();
  const { t: tx } = useT('collab');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TripCollaboratorRole>('viewer');
  // A key, not a string, so a language switch re-translates it.
  const [error, setError] = useState<InviteError | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);
  const { share, sharing, feedback } = useShareAction();

  function handleClose() {
    setEmail('');
    setRole('viewer');
    setError(null);
    setResult(null);
    setCopied(false);
    onClose();
  }

  async function handleInvite() {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setError({ key: 'invite.errors.emailRequired', field: true });
      return;
    }
    if (!EMAIL_RE.test(normalized)) {
      setError({ key: 'invite.errors.emailInvalid', field: true });
      return;
    }
    setError(null);
    try {
      const res = await inviteMutation.mutateAsync({ tripId, inviteeEmail: normalized, role });
      setResult({ url: res.inviteUrl, email: normalized, emailSent: res.emailSent });
    } catch (err) {
      setError(inviteError(err));
    }
  }

  async function handleCopy() {
    if (!result) return;
    if (await copyToClipboard(result.url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={handleClose} accessibilityLabel="Invite collaborator">
      <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header" aria-level={2}>
        {result ? 'Invite ready' : 'Invite collaborator'}
      </Text>

      {result ? (
        <View style={{ gap: t.spacing.md }}>
          <Text
            style={[t.typography.body, { color: result.emailSent ? t.colors.text : t.colors.warningText }]}
            accessibilityLiveRegion="polite"
          >
            {result.emailSent
              ? `We emailed ${result.email}. You can also send them the link directly.`
              : `We couldn't email ${result.email}. Share the invite link with them instead.`}
          </Text>
          <View
            style={[
              styles.urlBox,
              { borderColor: t.colors.border, borderRadius: t.radius.md, backgroundColor: t.colors.bgMuted, padding: t.spacing.md },
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]} selectable numberOfLines={2}>
              {result.url}
            </Text>
          </View>
          <Button
            label="Share invite link"
            onPress={() =>
              void share({
                url: result.url,
                title: `Join ${tripTitle} on Tripvisor`,
                message: `You're invited to plan ${tripTitle} with me on Tripvisor. Sign in with ${result.email} to join.`,
              })
            }
            loading={sharing}
            leftIcon={<Icon name="share-2" size={18} color={t.colors.primaryText} />}
            accessibilityLabel={`Share the invite link for ${result.email}`}
          />
          <Button
            label={copied ? 'Copied!' : 'Copy invite link'}
            variant="secondary"
            onPress={handleCopy}
            disabled={copied}
            accessibilityLabel={copied ? 'Invite link copied to clipboard' : 'Copy invite link to clipboard'}
          />
          {feedback ? (
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]} accessibilityLiveRegion="polite">
              {feedback}
            </Text>
          ) : null}
          <Button label="Done" variant="ghost" onPress={handleClose} />
        </View>
      ) : (
        <View style={{ gap: t.spacing.md }}>
          <View style={{ gap: t.spacing.xs }}>
            <Text nativeID="invite-email-label" style={[t.typography.caption, { color: t.colors.textMuted }]}>
              Email address
            </Text>
            <TextInput
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setError(null);
              }}
              placeholder="friend@example.com"
              placeholderTextColor={t.colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              returnKeyType="send"
              onSubmitEditing={() => void handleInvite()}
              accessibilityLabel="Collaborator email address"
              accessibilityLabelledBy="invite-email-label"
              style={[
                styles.input,
                {
                  borderColor: error?.field ? t.colors.danger : t.colors.border,
                  borderRadius: t.radius.md,
                  backgroundColor: t.colors.bgElevated,
                  color: t.colors.text,
                  ...t.typography.body,
                  padding: t.spacing.md,
                },
              ]}
            />
            {error?.field ? (
              <Text style={[t.typography.caption, { color: t.colors.danger }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
                {tx(error.key)}
              </Text>
            ) : null}
          </View>

          <SegmentedControl<TripCollaboratorRole> label="Role" value={role} onChange={setRole} options={ROLE_OPTIONS} />
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{ROLE_COPY[role].hint}.</Text>

          {/* Quota / permission / server failures: about the invite, not the email. */}
          {error && !error.field ? (
            <Text style={[t.typography.caption, { color: t.colors.danger }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
              {tx(error.key)}
            </Text>
          ) : null}

          <Button
            label="Send invite"
            onPress={() => void handleInvite()}
            loading={inviteMutation.isPending}
            accessibilityLabel="Send invite"
          />
          <Button label="Cancel" variant="ghost" onPress={handleClose} />
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  urlBox: { borderWidth: 1 },
  input: { borderWidth: 1, minHeight: 48 },
});
