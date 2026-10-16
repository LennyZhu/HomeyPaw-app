import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PurchasesPackage } from 'react-native-purchases';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { IconButton } from '@/components/icon-button';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { useCurrentFamily } from '@/features/family/use-current-family';
import { spacing } from '@/theme';
import {
  loadSandboxPackages,
  manageAppleSubscription,
  purchaseFamilyPlus,
  readFamilyBillingState,
  reconcileBilling,
  restoreFamilyPlus,
} from './billing-client';

export default function FamilyPlusSandboxScreen() {
  const { user } = useAuth();
  const { currentFamilyId, currentMembership } = useCurrentFamily();
  return (
    <SandboxContent
      key={`${user?.id ?? ''}:${currentFamilyId ?? ''}`}
      userId={user?.id ?? null}
      currentFamilyId={currentFamilyId}
      role={currentMembership?.role ?? null}
    />
  );
}

function SandboxContent({
  userId,
  currentFamilyId,
  role,
}: {
  userId: string | null;
  currentFamilyId: string | null;
  role: 'owner' | 'member' | 'viewer' | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const state = useQuery({
    queryKey: ['family-billing-sandbox', userId, currentFamilyId],
    queryFn: () => readFamilyBillingState(currentFamilyId!),
    enabled: Boolean(userId && currentFamilyId),
  });
  const action = async (work: () => Promise<string | void>) => {
    if (busy || !userId) return;
    setBusy(true);
    try {
      const outcome = await work();
      if (!mounted.current) return;
      setResult(t(`billingSandbox.${outcome ?? 'ready'}`));
      await state.refetch();
    } catch {
      if (mounted.current) setResult(t('billingSandbox.unavailable'));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <IconButton
          icon="chevron-back"
          accessibilityLabel={t('common.back')}
          onPress={() => router.back()}
        />
        <AppText variant="title2">{t('billingSandbox.title')}</AppText>
      </View>
      <AppText tone="secondary">{t('billingSandbox.notice')}</AppText>
      {!currentFamilyId ? (
        <AppText>{t('billingSandbox.noFamily')}</AppText>
      ) : (
        <>
          <AppText>
            {!state.data
              ? t('billingSandbox.checking')
              : state.data.tier === 'plus'
                ? t('billingSandbox.plus')
                : state.data?.tier === 'transition'
                  ? t('billingSandbox.transition')
                  : t('billingSandbox.free')}
          </AppText>
          {state.error ? (
            <AppText tone="secondary">
              {t('billingSandbox.unavailable')}
            </AppText>
          ) : null}
          {role === 'owner' && !state.data?.purchase_blocked ? (
            <>
              <AppButton
                variant="secondary"
                disabled={busy || !state.data?.sandbox_enabled}
                label={t('billingSandbox.loadProducts')}
                onPress={() =>
                  void action(async () => {
                    const items = await loadSandboxPackages(userId!);
                    if (mounted.current) setPackages(items);
                    if (!items.length) throw new Error('NO_PRODUCTS');
                  })
                }
              />
              {packages.map((item) => (
                <AppButton
                  key={item.identifier}
                  disabled={busy || Boolean(state.data?.pending_intent)}
                  label={`${t(item.packageType === 'ANNUAL' ? 'billingSandbox.yearly' : 'billingSandbox.monthly')} · ${item.product.priceString}`}
                  onPress={() =>
                    void action(() =>
                      purchaseFamilyPlus(userId!, currentFamilyId, item),
                    )
                  }
                />
              ))}
            </>
          ) : (
            <AppText tone="secondary">
              {t(
                state.data?.purchase_blocked
                  ? 'billingSandbox.alreadySubscribed'
                  : 'billingSandbox.ownerOnly',
              )}
            </AppText>
          )}
        </>
      )}
      {userId ? (
        <>
          <AppButton
            variant="secondary"
            disabled={busy}
            label={t('billingSandbox.restore')}
            onPress={() => void action(() => restoreFamilyPlus(userId!))}
          />
          <AppButton
            variant="ghost"
            disabled={busy}
            label={t('billingSandbox.refresh')}
            onPress={() => void action(reconcileBilling)}
          />
          <AppButton
            variant="ghost"
            disabled={busy}
            label={t('billingSandbox.manage')}
            onPress={() => void action(() => manageAppleSubscription(userId!))}
          />
        </>
      ) : null}
      {result ? (
        <AppText accessibilityLiveRegion="polite" tone="secondary">
          {result}
        </AppText>
      ) : null}
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingTop: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
