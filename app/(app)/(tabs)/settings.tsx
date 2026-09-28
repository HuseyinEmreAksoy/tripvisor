/**
 * Settings screen — Redesigned with profile section, visual theme picker,
 * grouped action cards, and improved layout.
 *
 * Phase 25 Step 25.9: added "Account" section with:
 *   - Change email modal (calls useChangeEmail)
 *   - Sign out button (calls useSignOut)
 *
 * Auth is passwordless (magic link + Google), so there is no "Change
 * password" entry — it would contradict the sign-in model.
 *
 * Desktop: max-width 720px centered.
 */
import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Heading, Icon, Screen, TAB_SCREEN_EDGES, type IconName } from '@/components';
import { useSession, useSignOut, useExportAccount, supabase, useChangeEmail, AuthMutationError } from '@/api';
import { teardownTier1Sync } from '@/sync/hydrate';
import { wipeTier1PersistedStorage } from '@/sync/wipe';
import { useTheme, useThemeControls, type ThemeMode } from '@/theme';
import { confirmDestructive } from '@/lib/confirm';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useRouter } from 'expo-router';
import { PRIVACY_HREF, TERMS_HREF } from '@/components/legal/LegalLinks';

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: IconName }> = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'sun-moon' },
];

export default function SettingsScreen() {
  const t = useTheme();
  const bp = useBreakpoint();
  const isDesktop = bp === 'desktop';
  const { data: session } = useSession();
  const { mode, setMode } = useThemeControls();
  const signOut = useSignOut();
  const exportAccount = useExportAccount();
  const qc = useQueryClient();
  const router = useRouter();

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Phase 25 Step 25.9: change email modal
  const [emailModalOpen, setEmailModalOpen] = useState(false);

  const email = session?.user?.email ?? '—';
  const initial = email[0]?.toUpperCase() ?? '?';

  const handleSignOut = () => {
    signOut.mutate();
  };

  const handleDeleteAccount = async () => {
    const confirmed = await confirmDestructive({
      title: 'Delete account?',
      message:
        'This permanently deletes your account and all trips. This cannot be undone.',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    setIsDeleting(true);
    setDeleteError(null);

    // Captured BEFORE the server deletion — the session (and its user id)
    // is gone once sign-out lands, but the Tier-1 wipe below needs it to
    // target the `tier1/<userId>/…` persist namespaces.
    const userId = session?.user?.id;

    try {
      const { error } = await supabase.functions.invoke('delete-account', {
        method: 'POST',
      });

      if (error) {
        setDeleteError(error.message ?? 'Failed to delete account. Please try again.');
        return;
      }

      // ADR-0010 §2 (S2.8.11): account deletion is the ONE lifecycle event
      // that wipes Tier-1 persisted data. Gate the engine off FIRST
      // (idempotent — the sign-out below re-runs it as a no-op), then
      // RAW-wipe the per-user storage namespaces underneath the engine.
      // Best-effort by contract: the account is already gone server-side,
      // so a failed wipe (breadcrumbed inside) must not block sign-out.
      if (userId) {
        teardownTier1Sync();
        await wipeTier1PersistedStorage(userId);
      }

      await signOut.mutateAsync();
      qc.clear();
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'An unexpected error occurred.',
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExport = () => {
    exportAccount.reset();
    exportAccount.mutate();
  };

  const screenDisabled = isDeleting || signOut.isPending || exportAccount.isPending;

  const contentStyle = isDesktop ? styles.desktopContainer : undefined;
  const cardStyle: ViewStyle = {
    borderRadius: t.radius.xl,
    backgroundColor: t.colors.cardBgSolid,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.shadows.sm(t.colors.shadowColor),
    overflow: 'hidden',
  };

  return (
    <Screen padded={false} edges={TAB_SCREEN_EDGES}>
      <ScrollView contentContainerStyle={[{ padding: t.spacing.lg, gap: t.spacing.lg }, contentStyle]}>
        {/* Tab root (Profile tab, M4 X1.1) — the tab bar is the way back. */}
        <Heading level={1}>Profile & settings</Heading>

        {/* ─── Profile / Account section ───────────────────────────────── */}
        <Text
          style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}
          accessibilityRole="header"
          aria-level={2}
        >
          Account
        </Text>

        <View
          style={[
            styles.profileCard,
            {
              borderRadius: t.radius.xl,
              backgroundColor: t.colors.cardBgSolid,
              borderWidth: 1,
              borderColor: t.colors.border,
              padding: t.spacing.lg,
              ...t.shadows.sm(t.colors.shadowColor),
            },
          ]}
        >
          {/* Avatar with gradient ring */}
          <View
            style={[
              styles.avatarRing,
              {
                backgroundColor: t.colors.primary,
                borderRadius: t.radius.pill,
              },
            ]}
          >
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={[t.typography.caption, { color: t.colors.textMuted }]}
              accessibilityRole="none"
            >
              Signed in as
            </Text>
            <Text
              style={[t.typography.bodyStrong, { color: t.colors.text }]}
              accessibilityLabel={`Email: ${email}`}
              accessibilityRole="text"
              selectable
            >
              {email}
            </Text>
          </View>
        </View>

        {/* Change email (passwordless auth — no password to change) */}
        <View
          style={[
            styles.actionsCard,
            {
              borderRadius: t.radius.xl,
              backgroundColor: t.colors.cardBgSolid,
              borderWidth: 1,
              borderColor: t.colors.border,
              ...t.shadows.sm(t.colors.shadowColor),
              overflow: 'hidden',
            },
          ]}
        >
          <Button
            variant="ghost"
            label="Change email"
            leftIcon={<Icon name="mail" size={18} color={t.colors.primaryInk} />}
            onPress={() => setEmailModalOpen(true)}
            disabled={screenDisabled}
            accessibilityLabel="Change email address"
          />
        </View>

        {/* ─── Theme picker — visual cards ──────────────────────────────── */}
        <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}
          accessibilityRole="header"
          aria-level={2}
        >
          Appearance
        </Text>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map((opt) => {
            const active = opt.value === mode;
            return (
              <Pressable
                key={opt.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={opt.label}
                onPress={() => setMode(opt.value)}
                style={({ pressed }) => [
                  styles.themeCard,
                  {
                    backgroundColor: active ? t.colors.gradientSubtle : t.colors.cardBgSolid,
                    borderColor: active ? t.colors.primary : t.colors.border,
                    borderRadius: t.radius.lg,
                    ...(active ? t.shadows.glow(t.colors.glowPrimary) : t.shadows.sm(t.colors.shadowColor)),
                  },
                  pressed && { opacity: 0.8 },
                  Platform.OS === 'web' && ({
                    transition: 'all 0.2s ease',
                    cursor: 'pointer',
                  } as ViewStyle),
                ]}
              >
                <Icon name={opt.icon} size={24} color={active ? t.colors.primary : t.colors.text} />
                <Text
                  style={[
                    t.typography.caption,
                    {
                      color: active ? t.colors.primary : t.colors.text,
                      fontWeight: active ? '700' : '500',
                    },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ─── Actions card ──────────────────────────────────────────────── */}
        <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}
          accessibilityRole="header"
          aria-level={2}
        >
          Your data
        </Text>
        <View style={[styles.actionsCard, cardStyle]}>
          {/* Export */}
          <Button
            variant="ghost"
            label="Export my data"
            leftIcon={<Icon name="download" size={18} color={t.colors.primaryInk} />}
            onPress={handleExport}
            loading={exportAccount.isPending}
            disabled={screenDisabled || exportAccount.isPending}
            accessibilityLabel="Export my data as JSON"
            accessibilityHint="Downloads a JSON file with all your trips and places."
          />

          <View style={[styles.divider, { backgroundColor: t.colors.border }]} />

          {/* Sign out */}
          <Button
            variant="ghost"
            label="Sign out"
            leftIcon={<Icon name="log-out" size={18} color={t.colors.primaryInk} />}
            onPress={handleSignOut}
            loading={signOut.isPending}
            disabled={screenDisabled}
          />
        </View>

        {/* ─── Privacy & legal (v2 M4 X3.2) ─────────────────────────────── */}
        <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}
          accessibilityRole="header"
          aria-level={2}
        >
          Privacy & legal
        </Text>
        <View style={[styles.actionsCard, cardStyle]}>
          <Button variant="ghost" label="Privacy policy" leftIcon={<Icon name="lock" size={18} color={t.colors.primaryInk} />} onPress={() => router.push(PRIVACY_HREF)} accessibilityRole="link" accessibilityLabel="Privacy policy" />
          <View style={[styles.divider, { backgroundColor: t.colors.border }]} />
          <Button variant="ghost" label="Terms of use" leftIcon={<Icon name="file-text" size={18} color={t.colors.primaryInk} />} onPress={() => router.push(TERMS_HREF)} accessibilityRole="link" accessibilityLabel="Terms of use" />
        </View>

        {/* ─── Delete account (Play policy: easy to find, own section) ─────── */}
        <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}
          accessibilityRole="header"
          aria-level={2}
        >
          Delete account
        </Text>
        <View style={[cardStyle, { padding: t.spacing.lg, gap: t.spacing.md }]}>
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
            Permanently deletes your account and everything in it: trips, places, expenses, packing lists, uploaded
            documents and share links. Trips shared with you stay with their owners. Export your data first if you want a copy.
          </Text>
          <Button
            variant="danger"
            label="Delete account"
            leftIcon={<Icon name="trash" size={18} color={t.colors.dangerText} />}
            onPress={handleDeleteAccount}
            loading={isDeleting}
            disabled={screenDisabled}
            accessibilityLabel="Delete account permanently"
            accessibilityHint="Requires confirmation. Permanently removes your account and all trips."
          />
        </View>

        {/* ─── Inline errors ─────────────────────────────────────────────── */}
        {exportAccount.error ? (
          <Text
            style={[t.typography.small, { color: t.colors.danger, textAlign: 'center' }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {exportAccount.error.message ?? 'Failed to export data. Please try again.'}
          </Text>
        ) : null}

        {deleteError ? (
          <Text
            style={[t.typography.small, { color: t.colors.danger, textAlign: 'center' }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {deleteError}
          </Text>
        ) : null}
      </ScrollView>

      {/* ─── Change Email modal ─────────────────────────────────────────── */}
      <ChangeEmailModal
        visible={emailModalOpen}
        currentEmail={email}
        onClose={() => setEmailModalOpen(false)}
      />
    </Screen>
  );
}

// ── ChangeEmailModal ──────────────────────────────────────────────────────────

function ChangeEmailModal({
  visible,
  currentEmail,
  onClose,
}: {
  visible: boolean;
  currentEmail: string;
  onClose: () => void;
}) {
  const t = useTheme();
  const changeEmail = useChangeEmail();
  const [newEmail, setNewEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function reset() {
    setNewEmail('');
    setErrorMsg(null);
    setSuccessMsg(null);
    changeEmail.reset();
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    setErrorMsg(null);
    setSuccessMsg(null);
    const trimmed = newEmail.trim();
    if (!trimmed) {
      setErrorMsg('Email is required.');
      return;
    }
    try {
      await changeEmail.mutateAsync({ newEmail: trimmed });
      setSuccessMsg(`Check your inbox at ${trimmed} to confirm the change.`);
    } catch (err) {
      if (err instanceof AuthMutationError) {
        if (err.code === 'email_exists') {
          setErrorMsg('That email is already in use.');
        } else {
          setErrorMsg(err.message ?? 'Something went wrong. Please try again.');
        }
      } else {
        setErrorMsg('Something went wrong. Please try again.');
      }
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      accessibilityViewIsModal
    >
      <View style={modalStyles.overlay}>
      <View style={[modalStyles.sheet, { backgroundColor: t.colors.bgElevated, borderRadius: t.radius.xl }]}>
        <Text style={[t.typography.subtitle, { color: t.colors.text, marginBottom: t.spacing.md }]}>
          Change email
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted, marginBottom: t.spacing.sm }]}>
          Current: {currentEmail}
        </Text>
        <TextInput
          value={newEmail}
          onChangeText={(v) => { setNewEmail(v); setErrorMsg(null); setSuccessMsg(null); }}
          placeholder="New email address"
          placeholderTextColor={t.colors.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="New email address"
          style={[
            modalStyles.input,
            {
              borderColor: errorMsg ? t.colors.danger : t.colors.border,
              borderRadius: t.radius.sm,
              color: t.colors.text,
              backgroundColor: t.colors.bg,
              ...t.typography.body,
            },
          ]}
        />
        {errorMsg ? (
          <Text
            style={[t.typography.caption, { color: t.colors.danger, marginTop: t.spacing.xs }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {errorMsg}
          </Text>
        ) : null}
        {successMsg ? (
          <Text
            style={[t.typography.caption, { color: t.colors.success, marginTop: t.spacing.xs }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {successMsg}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: t.spacing.sm, marginTop: t.spacing.md }}>
          <Button
            variant="ghost"
            label="Cancel"
            onPress={handleClose}
            fullWidth={false}
          />
          <View style={{ flex: 1 }}>
            <Button
              label={successMsg ? 'Done' : 'Send confirmation'}
              onPress={successMsg ? handleClose : handleSubmit}
              loading={changeEmail.isPending}
              disabled={changeEmail.isPending}
            />
          </View>
        </View>
      </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarRing: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  themeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  themeCard: {
    flex: 1,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 6,
  },
  actionsCard: {},
  divider: {
    height: 1,
    marginHorizontal: 16,
  },
  // Desktop layout: max-width 720px centered.
  desktopContainer: {
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    padding: 24,
    ...Platform.select({
      web: { boxShadow: '0 8px 32px rgba(0,0,0,0.2)' } as ViewStyle,
      default: {},
    }),
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    height: 44,
  },
});
