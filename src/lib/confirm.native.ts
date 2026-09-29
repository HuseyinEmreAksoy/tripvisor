/**
 * confirm.native.ts — Destructive confirmation dialog on iOS and Android.
 * The web counterpart (confirm.web.ts) uses window.confirm.
 *
 * Uses React Native's Alert.alert which renders a native OS dialog.
 * Metro resolves .native.ts before confirm.ts on iOS/Android builds.
 * Consumers import as `@/lib/confirm`.
 */
import { Alert } from 'react-native';
import { i18n } from '@/i18n';

export interface ConfirmDestructiveOpts {
  title: string;
  message: string;
  confirmLabel: string;
  /** Defaults to `common:actions.cancel` in the app language. */
  cancelLabel?: string;
}

/**
 * Shows a native Alert with Cancel and a destructive confirm button.
 * Resolves true if the user tapped the destructive button, false if they
 * tapped Cancel or dismissed.
 */
export async function confirmDestructive(opts: ConfirmDestructiveOpts): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      opts.title,
      opts.message,
      [
        {
          text: opts.cancelLabel ?? i18n.t('common:actions.cancel'),
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: opts.confirmLabel,
          style: 'destructive',
          onPress: () => resolve(true),
        },
      ],
      // Prevent dismissal by tapping outside — user must explicitly choose
      { cancelable: false },
    );
  });
}
