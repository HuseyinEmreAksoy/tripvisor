import { useState } from 'react';
import { Redirect, type Href } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useSession } from '@/api';
import { usePendingRedirect } from '@/hooks/usePendingRedirect';
import { Onboarding, useOnboardingGate, type OnboardingExit } from '@/components/onboarding';
import { useT } from '@/i18n';

export default function Root() {
  const { t: tx } = useT();
  const { data: session, isLoading } = useSession();
  // Magic links land on `/`; consume any stored post-login destination here.
  const pending = usePendingRedirect(!!session);
  // v2 M4 X3.2: first-run intro, signed-out visitors only. A session (returning
  // user / magic-link landing) or a pending invite redirect skips it; see
  // src/components/onboarding/onboardingFlag.ts. Invite and share links never
  // route through this screen.
  const onboarding = useOnboardingGate(!isLoading && !session, !!session);
  const [exit, setExit] = useState<OnboardingExit | null>(null);

  const spinner = (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator accessibilityLabel={tx('loading')} />
    </View>
  );

  if (isLoading || (session && !pending.ready)) return spinner;

  if (session) return <Redirect href={(pending.path ?? '/trips') as Href} />;

  if (exit) return <Redirect href={exit === 'signup' ? '/signup' : '/login'} />;
  if (!onboarding.ready) return spinner;
  if (onboarding.show) {
    return (
      <Onboarding
        onFinish={(dest) => {
          // Exit first: `finish()` flips `show` off, which would otherwise
          // render the default /login redirect before a "signup" exit lands.
          setExit(dest);
          void onboarding.finish();
        }}
      />
    );
  }
  return <Redirect href="/login" />;
}
