/**
 * Settings screen
 *
 * Reachable via the "Settings" link in the trips list header.
 * Provides: email display, theme picker (Light / Dark / System),
 * sign-out, and delete account (with destructive confirm + Edge Function call).
 *
 * Server state: session email from useSession() (TanStack Query).
 * Theme state: useThemeControls() from ThemeProvider.
 */
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Heading, Screen, SegmentedControl } from '@/components';
import { useSession, useSignOut, supabase } from '@/api';
import { useTheme, useThemeControls, type ThemeMode } from '@/theme';
import { confirmDestructive } from '@/lib/confirm';

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export default function SettingsScreen() {
  const t = useTheme();
  const { data: session } = useSession();
  const { mode, setMode } = useThemeControls();
  const signOut = useSignOut();
  const qc = useQueryClient();

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const email = session?.user?.email ?? '—';

  const handleSignOut = () => {
    // The auth gate in (app)/_layout.tsx detects the cleared session and
    // redirects to /login automatically — no manual navigation needed here.
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

    try {
      const { error } = await supabase.functions.invoke('delete-account', {
        method: 'POST',
      });

      if (error) {
        // Surface to the user inline; do not throw so we stay in this screen.
        setDeleteError(error.message ?? 'Failed to delete account. Please try again.');
        return;
      }

      // Sign out FIRST so the local JWT is gone before anything tries to
      // re-fetch with a now-invalid token (M1 from review). Awaiting the
      // mutation resolution avoids a flicker of 401 errors between
      // server-side auth-delete and the local session being cleared.
      await signOut.mutateAsync();
      // Drop all cached data so the next user sees a clean slate.
      qc.clear();
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'An unexpected error occurred.',
      );
    } finally {
      setIsDeleting(false);
    }
  };

  // While deleting, block the whole screen from further interaction.
  const screenDisabled = isDeleting || signOut.isPending;

  return (
    <Screen>
      <Heading level={1}>Settings</Heading>

      {/* ─── Email row ─────────────────────────────────────────────────── */}
      <View
        style={{
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: t.radius.md,
          paddingVertical: t.spacing.md,
          paddingHorizontal: t.spacing.lg,
          backgroundColor: t.colors.bgElevated,
          gap: t.spacing.xs,
        }}
      >
        <Text
          style={[t.typography.caption, { color: t.colors.textMuted }]}
          accessibilityRole="none"
        >
          Signed in as
        </Text>
        <Text
          style={[t.typography.body, { color: t.colors.text }]}
          accessibilityLabel={`Email: ${email}`}
          accessibilityRole="text"
          selectable
        >
          {email}
        </Text>
      </View>

      {/* ─── Theme picker ──────────────────────────────────────────────── */}
      <SegmentedControl
        label="Appearance"
        value={mode}
        options={THEME_OPTIONS}
        onChange={setMode}
      />

      {/* ─── Spacer ────────────────────────────────────────────────────── */}
      <View style={{ flex: 1 }} />

      {/* ─── Sign out ──────────────────────────────────────────────────── */}
      <Button
        variant="secondary"
        label="Sign out"
        onPress={handleSignOut}
        loading={signOut.isPending}
        disabled={screenDisabled}
      />

      {/* ─── Delete account ────────────────────────────────────────────── */}
      <Button
        variant="danger"
        label="Delete account"
        onPress={handleDeleteAccount}
        loading={isDeleting}
        disabled={screenDisabled}
        accessibilityLabel="Delete account permanently"
        accessibilityHint="Requires confirmation. Permanently removes your account and all trips."
      />

      {/* ─── Inline delete error ───────────────────────────────────────── */}
      {deleteError ? (
        <Text
          style={[t.typography.small, { color: t.colors.danger, textAlign: 'center' }]}
          accessibilityRole="alert"
          // accessibilityLiveRegion="polite" surfaces the error to screen readers on web
          // without requiring focus movement. On native, accessibilityRole="alert"
          // triggers the equivalent OS-level announcement.
          accessibilityLiveRegion="polite"
        >
          {deleteError}
        </Text>
      ) : null}
    </Screen>
  );
}
