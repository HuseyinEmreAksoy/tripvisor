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
 * M5 Y1.4: every string comes from the `profile` / `errors` namespaces, and
 * a Language section (System / Türkçe / English) switches the app language
 * live. The change-email modal lives in src/components/profile/.
 *
 * Desktop: max-width 720px centered.
 */
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Heading, Icon, Screen, TAB_SCREEN_EDGES, type IconName } from '@/components';
import { useSession, useSignOut, useExportAccount, supabase } from '@/api';
import { teardownTier1Sync } from '@/sync/hydrate';
import { wipeTier1PersistedStorage } from '@/sync/wipe';
import { useTheme, useThemeControls, type ThemeMode } from '@/theme';
import { confirmDestructive } from '@/lib/confirm';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useRouter } from 'expo-router';
import { PRIVACY_HREF, TERMS_HREF } from '@/components/legal/LegalLinks';
import { ChangeEmailModal } from '@/components/profile/ChangeEmailModal';
import { isAccountGoneError } from '@/components/profile/deleteAccountOutcome';
import { LanguagePicker } from '@/components/profile/LanguagePicker';
import { toLocaleUpper, useT } from '@/i18n';

const THEME_OPTIONS = [
  { value: 'light', labelKey: 'theme.light', icon: 'sun' },
  { value: 'dark', labelKey: 'theme.dark', icon: 'moon' },
  { value: 'system', labelKey: 'theme.system', icon: 'sun-moon' },
] as const satisfies ReadonlyArray<{ value: ThemeMode; labelKey: string; icon: IconName }>;

type ErrorKey = 'errors:account.deleteFailed' | 'errors:unexpected';

export default function SettingsScreen() {
  const t = useTheme();
  const { t: tx } = useT(['profile', 'common', 'errors']);
  const bp = useBreakpoint();
  const isDesktop = bp === 'desktop';
  const { data: session } = useSession();
  const { mode, setMode } = useThemeControls();
  const signOut = useSignOut();
  const exportAccount = useExportAccount();
  const qc = useQueryClient();
  const router = useRouter();

  const [isDeleting, setIsDeleting] = useState(false);
  // A key, not a string, so a language switch re-translates the message.
  const [deleteError, setDeleteError] = useState<ErrorKey | null>(null);

  // Phase 25 Step 25.9: change email modal
  const [emailModalOpen, setEmailModalOpen] = useState(false);

  const email = session?.user?.email ?? '—';
  // Locale-aware: an "i…" address shows "İ" in Turkish.
  const initial = email[0] ? toLocaleUpper(email[0]) : '?';

  const handleSignOut = () => {
    signOut.mutate();
  };

  const handleDeleteAccount = async () => {
    const confirmed = await confirmDestructive({
      title: tx('delete.confirmTitle'),
      message: tx('delete.confirmMessage'),
      confirmLabel: tx('delete.confirmLabel'),
      cancelLabel: tx('common:actions.cancel'),
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

      // A 401 on retry or "Account removed but data cleanup failed" means the
      // auth user is already gone: fall through to the wipe + sign-out so the
      // device never keeps a zombie session and the deleted user's data.
      if (error && !(await isAccountGoneError(error))) {
        setDeleteError('errors:account.deleteFailed');
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
    } catch {
      setDeleteError('errors:unexpected');
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
        <Heading level={1}>{tx('title')}</Heading>

        {/* ─── Profile / Account section ───────────────────────────────── */}
        <Text
          style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}
          accessibilityRole="header"
          aria-level={2}
        >
          {tx('sections.account')}
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
            <Text style={[styles.avatarText, { color: t.colors.primaryText }]}>{initial}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={[t.typography.caption, { color: t.colors.textMuted }]}
              accessibilityRole="none"
            >
              {tx('account.signedInAs')}
            </Text>
            <Text
              style={[t.typography.bodyStrong, { color: t.colors.text }]}
              accessibilityLabel={tx('account.emailA11y', { email })}
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
            label={tx('account.changeEmail')}
            leftIcon={<Icon name="mail" size={18} color={t.colors.primaryInk} />}
            onPress={() => setEmailModalOpen(true)}
            disabled={screenDisabled}
            accessibilityLabel={tx('account.changeEmailA11y')}
          />
        </View>

        {/* ─── Theme picker — visual cards ──────────────────────────────── */}
        <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}
          accessibilityRole="header"
          aria-level={2}
        >
          {tx('sections.appearance')}
        </Text>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map((opt) => {
            const active = opt.value === mode;
            return (
              <Pressable
                key={opt.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: active, selected: active }}
                accessibilityLabel={tx(opt.labelKey)}
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
                <Icon name={opt.icon} size={24} color={active ? t.colors.primaryInk : t.colors.text} />
                <Text
                  style={[
                    t.typography.caption,
                    {
                      color: active ? t.colors.primaryInk : t.colors.text,
                      fontWeight: active ? '700' : '500',
                    },
                  ]}
                >
                  {tx(opt.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ─── Language (M5 Y1.4) ──────────────────────────────────────────── */}
        <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}
          accessibilityRole="header"
          aria-level={2}
        >
          {tx('sections.language')}
        </Text>
        <LanguagePicker />

        {/* ─── Actions card ──────────────────────────────────────────────── */}
        <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}
          accessibilityRole="header"
          aria-level={2}
        >
          {tx('sections.data')}
        </Text>
        <View style={[styles.actionsCard, cardStyle]}>
          {/* Export */}
          <Button
            variant="ghost"
            label={tx('data.export')}
            leftIcon={<Icon name="download" size={18} color={t.colors.primaryInk} />}
            onPress={handleExport}
            loading={exportAccount.isPending}
            disabled={screenDisabled || exportAccount.isPending}
            accessibilityLabel={tx('data.exportA11y')}
            accessibilityHint={tx('data.exportHint')}
          />

          <View style={[styles.divider, { backgroundColor: t.colors.border }]} />

          {/* Sign out */}
          <Button
            variant="ghost"
            label={tx('data.signOut')}
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
          {tx('sections.legal')}
        </Text>
        <View style={[styles.actionsCard, cardStyle]}>
          <Button variant="ghost" label={tx('legal.privacy')} leftIcon={<Icon name="lock" size={18} color={t.colors.primaryInk} />} onPress={() => router.push(PRIVACY_HREF)} accessibilityRole="link" accessibilityLabel={tx('legal.privacy')} />
          <View style={[styles.divider, { backgroundColor: t.colors.border }]} />
          <Button variant="ghost" label={tx('legal.terms')} leftIcon={<Icon name="file-text" size={18} color={t.colors.primaryInk} />} onPress={() => router.push(TERMS_HREF)} accessibilityRole="link" accessibilityLabel={tx('legal.terms')} />
        </View>

        {/* ─── Delete account (Play policy: easy to find, own section) ─────── */}
        <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}
          accessibilityRole="header"
          aria-level={2}
        >
          {tx('sections.delete')}
        </Text>
        <View style={[cardStyle, { padding: t.spacing.lg, gap: t.spacing.md }]}>
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>{tx('delete.body')}</Text>
          <Button
            variant="danger"
            label={tx('delete.button')}
            leftIcon={<Icon name="trash" size={18} color={t.colors.dangerText} />}
            onPress={handleDeleteAccount}
            loading={isDeleting}
            disabled={screenDisabled}
            accessibilityLabel={tx('delete.a11y')}
            accessibilityHint={tx('delete.hint')}
          />
        </View>

        {/* ─── Inline errors ─────────────────────────────────────────────── */}
        {exportAccount.error ? (
          <Text
            style={[t.typography.small, { color: t.colors.danger, textAlign: 'center' }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {tx('errors:account.exportFailed')}
          </Text>
        ) : null}

        {signOut.error && !isDeleting ? (
          <Text
            style={[t.typography.small, { color: t.colors.danger, textAlign: 'center' }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {tx('errors:account.signOutFailed')}
          </Text>
        ) : null}

        {deleteError ? (
          <Text
            style={[t.typography.small, { color: t.colors.danger, textAlign: 'center' }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {tx(deleteError)}
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
