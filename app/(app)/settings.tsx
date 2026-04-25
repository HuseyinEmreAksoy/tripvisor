/**
 * Settings screen — Redesigned with profile section, visual theme picker,
 * grouped action cards, and improved layout.
 */
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { BackButton, Button, Heading, Screen } from '@/components';
import { useSession, useSignOut, useExportAccount, supabase } from '@/api';
import { useTheme, useThemeControls, type ThemeMode } from '@/theme';
import { confirmDestructive } from '@/lib/confirm';

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: string }> = [
  { value: 'light', label: 'Light', icon: '☀️' },
  { value: 'dark', label: 'Dark', icon: '🌙' },
  { value: 'system', label: 'System', icon: '🔄' },
];

export default function SettingsScreen() {
  const t = useTheme();
  const router = useRouter();
  const { data: session } = useSession();
  const { mode, setMode } = useThemeControls();
  const signOut = useSignOut();
  const exportAccount = useExportAccount();
  const qc = useQueryClient();

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

    try {
      const { error } = await supabase.functions.invoke('delete-account', {
        method: 'POST',
      });

      if (error) {
        setDeleteError(error.message ?? 'Failed to delete account. Please try again.');
        return;
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

  return (
    <Screen>
      <BackButton onPress={() => router.back()} label="Trips" />
      <Heading level={1}>Settings</Heading>

      {/* ─── Profile section ─────────────────────────────────────────── */}
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

      {/* ─── Theme picker — visual cards ──────────────────────────────── */}
      <View style={{ gap: t.spacing.xs }}>
        <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
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
      </View>

      {/* ─── Spacer ────────────────────────────────────────────────────── */}
      <View style={{ flex: 1 }} />

      {/* ─── Actions card ──────────────────────────────────────────────── */}
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
    </Screen>
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
});
