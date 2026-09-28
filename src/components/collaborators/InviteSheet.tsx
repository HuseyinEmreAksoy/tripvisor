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
import { ROLE_COPY } from './collaboratorModel';

const ROLE_OPTIONS: Array<{ value: TripCollaboratorRole; label: string }> = [
  { value: 'viewer', label: ROLE_COPY.viewer.label },
  { value: 'editor', label: ROLE_COPY.editor.label },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TripCollaboratorRole>('viewer');
  const [error, setError] = useState<string | null>(null);
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
      setError('Email address is required.');
      return;
    }
    if (!EMAIL_RE.test(normalized)) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    try {
      const res = await inviteMutation.mutateAsync({ tripId, inviteeEmail: normalized, role });
      setResult({ url: res.inviteUrl, email: normalized, emailSent: res.emailSent });
    } catch (err) {
      if (err instanceof CollaboratorError && err.code === 'already_invited') {
        setError('This person already has an invite for this trip. Cancel it first to send a new one.');
      } else if (err instanceof Error && err.message) {
        setError(err.message);
      } else {
        setError('Could not send invite. Please try again.');
      }
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
                  borderColor: error ? t.colors.danger : t.colors.border,
                  borderRadius: t.radius.md,
                  backgroundColor: t.colors.bgElevated,
                  color: t.colors.text,
                  ...t.typography.body,
                  padding: t.spacing.md,
                },
              ]}
            />
            {error ? (
              <Text style={[t.typography.caption, { color: t.colors.danger }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
          </View>

          <SegmentedControl<TripCollaboratorRole> label="Role" value={role} onChange={setRole} options={ROLE_OPTIONS} />
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{ROLE_COPY[role].hint}.</Text>

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
