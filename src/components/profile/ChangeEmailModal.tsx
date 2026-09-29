/**
 * ChangeEmailModal — Profile → Account → Change email (Phase 25 Step 25.9),
 * moved out of `(tabs)/settings.tsx` in M5 Y1.4. Supabase emails a
 * confirmation link to the new address; the change applies once it's clicked.
 */
import { useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { Button } from '@/components/Button';
import { useChangeEmail, AuthMutationError } from '@/api';
import { useTheme } from '@/theme';
import { useT } from '@/i18n';

type ErrorKey = 'errors:auth.emailRequired' | 'errors:auth.emailInUse' | 'errors:generic';

export function ChangeEmailModal({
  visible,
  currentEmail,
  onClose,
}: {
  visible: boolean;
  currentEmail: string;
  onClose: () => void;
}) {
  const t = useTheme();
  const { t: tx } = useT(['profile', 'common', 'errors']);
  const changeEmail = useChangeEmail();
  const [newEmail, setNewEmail] = useState('');
  // Keys, not strings, so a language switch re-translates the message.
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function reset() {
    setNewEmail('');
    setErrorKey(null);
    setSentTo(null);
    changeEmail.reset();
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    setErrorKey(null);
    setSentTo(null);
    const trimmed = newEmail.trim();
    if (!trimmed) {
      setErrorKey('errors:auth.emailRequired');
      return;
    }
    try {
      await changeEmail.mutateAsync({ newEmail: trimmed });
      setSentTo(trimmed);
    } catch (err) {
      setErrorKey(err instanceof AuthMutationError && err.code === 'email_exists' ? 'errors:auth.emailInUse' : 'errors:generic');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose} accessibilityViewIsModal>
      <View style={[styles.overlay, { backgroundColor: t.colors.scrim }]}>
        <View style={[styles.sheet, { backgroundColor: t.colors.bgElevated, borderRadius: t.radius.xl }]}>
          <Text
            style={[t.typography.subtitle, { color: t.colors.text, marginBottom: t.spacing.md }]}
            accessibilityRole="header"
          >
            {tx('changeEmail.title')}
          </Text>
          <Text style={[t.typography.caption, { color: t.colors.textMuted, marginBottom: t.spacing.sm }]}>
            {tx('changeEmail.current', { email: currentEmail })}
          </Text>
          <TextInput
            value={newEmail}
            onChangeText={(v) => {
              setNewEmail(v);
              setErrorKey(null);
              setSentTo(null);
            }}
            placeholder={tx('changeEmail.placeholder')}
            placeholderTextColor={t.colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={tx('changeEmail.placeholder')}
            style={[
              styles.input,
              {
                borderColor: errorKey ? t.colors.danger : t.colors.border,
                borderRadius: t.radius.sm,
                color: t.colors.text,
                backgroundColor: t.colors.bg,
                ...t.typography.body,
              },
            ]}
          />
          {errorKey ? (
            <Text
              style={[t.typography.caption, { color: t.colors.danger, marginTop: t.spacing.xs }]}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {tx(errorKey)}
            </Text>
          ) : null}
          {sentTo ? (
            <Text
              style={[t.typography.caption, { color: t.colors.success, marginTop: t.spacing.xs }]}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {tx('changeEmail.sent', { email: sentTo })}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: t.spacing.sm, marginTop: t.spacing.md }}>
            <Button variant="ghost" label={tx('common:actions.cancel')} onPress={handleClose} fullWidth={false} />
            <View style={{ flex: 1 }}>
              <Button
                label={sentTo ? tx('common:actions.done') : tx('changeEmail.submit')}
                onPress={sentTo ? handleClose : handleSubmit}
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
  overlay: {
    flex: 1,
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
