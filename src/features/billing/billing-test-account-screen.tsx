import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AuthField } from '@/features/auth/components/auth-field';
import { AuthScreen } from '@/features/auth/components/auth-screen';
import { FormMessage } from '@/features/auth/components/form-message';
import { FamilyPlusPreview } from './family-plus-screen';
import { useFamilyPlusPurchases } from './use-family-plus-purchases';
import {
  signInBillingTestAccount,
  type BillingTestAccount,
} from './billing-test-account';

function TestFamilyPlan({ account }: { account: BillingTestAccount }) {
  const summary = useQuery({
    queryKey: [
      'family',
      account.binding.user_id,
      account.binding.family_id,
      'plus-summary',
    ],
    queryFn: ({ signal }) => account.readSummary(signal),
    retry: false,
    gcTime: 0,
    refetchInterval: 15_000,
  });
  const billing = useFamilyPlusPurchases({
    userId: account.binding.user_id,
    familyId: account.binding.family_id,
    role: summary.data?.role ?? null,
    server: true,
    client: account.billing,
  });
  return (
    <FamilyPlusPreview
      initialRole={summary.data?.role ?? account.binding.role}
      hasFamily
      familyLoading={summary.isPending}
      familyError={summary.isError}
      retryFamily={() => void summary.refetch()}
      scene="unavailable"
      onSceneChange={() => undefined}
      mode="server"
      serverSnapshot={summary.data?.snapshot ?? null}
      serverRole={summary.data?.role ?? null}
      billing={billing}
      isolatedTest
    />
  );
}

export default function BillingTestAccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [account, setAccount] = useState<BillingTestAccount | null>(null);
  const alive = useRef(true);
  const submitting = useRef(false);
  const active = useRef<BillingTestAccount | null>(null);
  const [cache] = useState(() => new QueryClient());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void active.current?.close();
      cache.clear();
    };
  }, [cache]);
  const signIn = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const result = await signInBillingTestAccount(email, password);
      if (!alive.current) {
        await result.close();
        return;
      }
      active.current = result;
      setPassword('');
      setAccount(result);
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  };
  if (account)
    return (
      <QueryClientProvider client={cache}>
        <TestFamilyPlan account={account} />
      </QueryClientProvider>
    );
  return (
    <AuthScreen
      title={t('billingTestAccount.title')}
      subtitle={t('billingTestAccount.body')}
    >
      {failed ? <FormMessage message={t('billingTestAccount.denied')} /> : null}
      <AuthField
        label={t('auth.fields.email')}
        value={email}
        onChangeText={setEmail}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <AuthField
        label={t('auth.fields.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        secureToggleLabel={t('auth.fields.togglePassword')}
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={() => void signIn()}
      />
      <AppButton
        label={t('auth.signIn.submit')}
        onPress={() => void signIn()}
        loading={busy}
        disabled={!email.trim() || !password}
      />
      <AppButton
        label={t('common.back')}
        onPress={() => router.back()}
        variant="ghost"
      />
    </AuthScreen>
  );
}
