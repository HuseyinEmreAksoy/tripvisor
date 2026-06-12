/**
 * Settings screen — Redesigned with profile section, visual theme picker,
 * grouped action cards, and improved layout.
 *
 * Phase 25 Step 25.9: added "Account" section with:
 *   - Change email modal (calls useChangeEmail)
 *   - Change password modal (calls useChangePassword)
 *   - Sign out button (calls useSignOut)
 *
 * Desktop: max-width 720px centered.
 */
import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { BackButton, Button, Heading, Screen } from '@/components';
import { useSession, useSignOut, useExportAccount, supabase, useChangeEmail, useChangePassword, AuthMutationError } from '@/api';
import { teardownTier1Sync } from '@/sync/hydrate';
import { wipeTier1PersistedStorage } from '@/sync/wipe';
import { useTheme, useThemeControls, type ThemeMode } from '@/theme';
import { confirmDestructive } from '@/lib/confirm';
import { useBreakpoint } from '@/hooks/useBreakpoint';

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: string }> = [
  { value: 'light', label: 'Light', icon: '☀️' },
  { value: 'dark', label: 'Dark', icon: '🌙' },
  { value: 'system', label: 'System', icon: '🔄' },
];

export default function SettingsScreen() {
  const t = useTheme();
  const router = useRouter();
  const bp = useBreakpoint();
  const isDesktop = bp === 'desktop';
  const { data: session } = useSession();
  const { mode, setMode } = useThemeControls();
  const signOut = useSignOut();
  const exportAccount = useExportAccount();
  const qc = useQueryClient();

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Phase 25 Step 25.9: change email / password modals
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

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

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={[{ padding: t.spacing.lg, gap: t.spacing.lg }, contentStyle]}>
        <BackButton onPress={() => router.back()} label="Trips" />
        <Heading level={1}>Settings</Heading>

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

        {/* Change email + Change password buttons */}
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
            label="✉️ Change email"
            onPress={() => setEmailModalOpen(true)}
            disabled={screenDisabled}
            accessibilityLabel="Change email address"
          />
          <View style={[styles.divider, { backgroundColor: t.colors.border }]} />
          <Button
            variant="ghost"
            label="🔑 Change password"
            onPress={() => setPasswordModalOpen(true)}
            disabled={screenDisabled}
            accessibilityLabel="Change password"
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
                <Text style={styles.themeIcon}>{opt.icon}</Text>
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
          Data & Account
        </Text>
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
          {/* Export */}
          <Button
            variant="ghost"
            label="📦 Export my data"
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
            label="🚪 Sign out"
            onPress={handleSignOut}
            loading={signOut.isPending}
            disabled={screenDisabled}
          />

          <View style={[styles.divider, { backgroundColor: t.colors.border }]} />

          {/* Delete account */}
          <Button
            variant="danger"
            label="🗑️ Delete account"
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

      {/* ─── Change Password modal ──────────────────────────────────────── */}
      <ChangePasswordModal
        visible={passwordModalOpen}
        onClose={() => setPasswordModalOpen(false)}
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

// ── ChangePasswordModal ───────────────────────────────────────────────────────

function ChangePasswordModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const t = useTheme();
  const changePassword = useChangePassword();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function reset() {
    setNewPassword('');
    setConfirmPassword('');
    setErrorMsg(null);
    setSuccessMsg(null);
    changePassword.reset();
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!newPassword) {
      setErrorMsg('Password is required.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    try {
      await changePassword.mutateAsync({ newPassword });
      setSuccessMsg('Password changed.');
    } catch (err) {
      if (err instanceof AuthMutationError) {
        if (err.code === 'weak_password') {
          setErrorMsg('Use at least 8 characters.');
        } else if (err.code === 'same_password') {
          setErrorMsg('Use a different password from your current one.');
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
          Change password
        </Text>
        <TextInput
          value={newPassword}
          onChangeText={(v) => { setNewPassword(v); setErrorMsg(null); setSuccessMsg(null); }}
          placeholder="New password"
          placeholderTextColor={t.colors.textMuted}
          secureTextEntry
          accessibilityLabel="New password"
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
        <TextInput
          value={confirmPassword}
          onChangeText={(v) => { setConfirmPassword(v); setErrorMsg(null); setSuccessMsg(null); }}
          placeholder="Confirm new password"
          placeholderTextColor={t.colors.textMuted}
          secureTextEntry
          accessibilityLabel="Confirm new password"
          style={[
            modalStyles.input,
            {
              marginTop: t.spacing.sm,
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
              label={successMsg ? 'Done' : 'Change password'}
              onPress={successMsg ? handleClose : handleSubmit}
              loading={changePassword.isPending}
              disabled={changePassword.isPending}
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
  themeIcon: {
    fontSize: 24,
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
