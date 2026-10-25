import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { useContentLayout } from '@/components/content-container';
import { useFeedback } from '@/components/feedback-provider';
import { IconButton } from '@/components/icon-button';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { useCurrentFamily } from '@/features/family/use-current-family';
import { lightColors, radius, spacing } from '@/theme';
import { FamilyStorageSummary } from './components/family-storage-summary';
import { FamilyPlusBadge } from './components/family-plus-badge';
import { useFamilyPlus } from './use-family-plus';
import { emptyFamilyPlusServerSnapshot } from './family-plus-data';
import {
  isFamilyPlusAvailable,
  isFamilyPlusSandbox,
  isFamilyPlusRelease,
} from './family-plus-environment';
import {
  useFamilyPlusPurchases,
  type FamilyPlusPurchases,
} from './use-family-plus-purchases';
import {
  canSelectFamilyPlusPlan,
  familyPlusPrice,
  familyPlusIdentity,
  familyPlusTransition,
  familyPlusBenefitsTitle,
  type FamilyPlusAction,
  type FamilyPlusPeriod,
  type FamilyPlusRole,
  type FamilyPlusSnapshot,
} from './family-plus-presentation';
import {
  canUseFamilyPlusPreview,
  familyPlusPreviewAction,
  familyPlusPreviewScenes,
  familyPlusPreviewSnapshot,
  type FamilyPlusPreviewScene,
} from './family-plus-preview';

// Existing published policy addresses; no payment or provider URL here.
export const familyPlusLegalLinks = {
  terms: 'https://homeypaw.vercel.app/terms',
  privacy: 'https://homeypaw.vercel.app/privacy',
} as const;

export default function FamilyPlusScreen() {
  if (!isFamilyPlusAvailable()) return null;
  return <FamilyPlusDevelopmentScreen />;
}

function FamilyPlusDevelopmentScreen() {
  const { user } = useAuth();
  const context = useCurrentFamily();
  const preview = useFamilyPlus({
    userId: user?.id ?? null,
    familyId: context.currentFamilyId,
    role: context.currentMembership?.role ?? null,
    loading: context.familiesQuery.isPending,
    error: context.familiesQuery.isError,
  });
  return (
    <FamilyPlusPreview
      key={`${user?.id}:${context.currentFamilyId}:${context.currentMembership?.role}`}
      initialRole={context.currentMembership?.role ?? null}
      hasFamily={Boolean(context.currentFamilyId && context.currentMembership)}
      familyLoading={context.familiesQuery.isPending}
      familyError={context.familiesQuery.isError}
      retryFamily={() => void context.familiesQuery.refetch()}
      scene={preview.scene}
      onSceneChange={preview.setScene}
      mode={preview.mode}
      serverSnapshot={preview.mode === 'server' ? preview.snapshot : null}
      onServerMode={preview.setServerMode}
      onServerRetry={preview.retry}
      serverRole={preview.role}
      billingContext={{
        userId: user?.id ?? null,
        familyId: context.currentFamilyId,
      }}
    />
  );
}

export function FamilyPlusPreview({
  initialRole,
  hasFamily,
  familyLoading,
  familyError,
  retryFamily,
  scene,
  onSceneChange,
  mode = 'preview',
  serverSnapshot,
  onServerMode,
  onServerRetry,
  serverRole,
  billing: suppliedBilling,
  billingContext,
  isolatedTest = false,
}: {
  initialRole: FamilyPlusRole;
  hasFamily: boolean;
  familyLoading: boolean;
  familyError: boolean;
  retryFamily: () => void;
  scene: FamilyPlusPreviewScene;
  onSceneChange: (scene: FamilyPlusPreviewScene) => void;
  mode?: 'preview' | 'server';
  serverSnapshot?: FamilyPlusSnapshot | null;
  onServerMode?: () => void;
  onServerRetry?: () => void;
  serverRole?: FamilyPlusRole;
  billing?: FamilyPlusPurchases | undefined;
  billingContext?: { userId: string | null; familyId: string | null };
  isolatedTest?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  // This component is keyed by real user/Family/canonical role by its parent.
  // Purchase feedback, packages and pending UI cannot survive a scope change.
  const ownedBilling = useFamilyPlusPurchases({
    userId: billingContext?.userId ?? null,
    familyId: billingContext?.familyId ?? null,
    role: mode === 'server' ? (serverRole ?? null) : null,
    server:
      !suppliedBilling &&
      (isFamilyPlusSandbox() || isFamilyPlusRelease()) &&
      mode === 'server',
  });
  const billing =
    suppliedBilling ??
    (isFamilyPlusSandbox() || isFamilyPlusRelease() ? ownedBilling : undefined);
  const [role, setRole] = useState(initialRole);
  const [period, setPeriod] = useState<FamilyPlusPeriod>('yearly');
  const [toolsOpen, setToolsOpen] = useState(false);
  const { fontScale } = useContentLayout();
  const familyReady =
    hasFamily && initialRole !== null && !familyLoading && !familyError;
  const previewRole = initialRole === 'owner' ? role : initialRole;
  const effectiveScene = familyLoading
    ? 'loading'
    : familyError
      ? 'error'
      : !hasFamily
        ? 'empty'
        : initialRole === null
          ? 'unavailable'
          : scene;
  const snapshot =
    mode === 'server'
      ? {
          ...(serverSnapshot ?? emptyFamilyPlusServerSnapshot),
          prices: billing?.prices ?? [],
        }
      : familyPlusPreviewSnapshot(__DEV__, effectiveScene);
  const onAction = (action: FamilyPlusAction) => {
    if (mode === 'server' && billing) {
      void billing.action(action, period);
      return;
    }
    if (mode !== 'preview') return;
    const outcome = familyPlusPreviewAction(
      __DEV__,
      familyReady && initialRole === 'owner' ? previewRole : null,
      action,
    );
    showFeedback(t(`familyPlus.${outcome}`), 'info');
  };
  const openLegal = (kind: keyof typeof familyPlusLegalLinks) => {
    void Linking.openURL(familyPlusLegalLinks[kind]).catch(() =>
      showFeedback(t('familyPlus.linkError'), 'error'),
    );
  };

  return (
    <Screen scroll modal contentContainerStyle={styles.content}>
      <View style={styles.intro}>
        <View style={styles.header}>
          <IconButton
            icon="chevron-back"
            accessibilityLabel={t('common.back')}
            onPress={() => router.back()}
          />
          <AppText
            accessibilityRole="header"
            variant="title1"
            style={styles.grow}
          >
            Family Plus
          </AppText>
        </View>
        <AppText tone="secondary">{t('familyPlus.headline')}</AppText>
      </View>

      {isolatedTest || isFamilyPlusSandbox() ? (
        <View style={styles.previewNotice}>
          <AppText tone="secondary" variant="footnote">
            {t('familyPlus.purchase.sandboxNotice')}
          </AppText>
        </View>
      ) : isFamilyPlusRelease() ? null : (
        <View style={styles.previewNotice}>
          <View
            style={[
              styles.previewSummary,
              fontScale > 1.3 && styles.stackedSummary,
            ]}
          >
            <AppText
              tone="secondary"
              variant="footnote"
              style={fontScale > 1.3 ? undefined : styles.grow}
            >
              {t(
                mode === 'preview'
                  ? 'familyPlus.previewSummary'
                  : 'familyPlus.localReadOnly',
              )}
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: toolsOpen }}
              onPress={() => setToolsOpen(!toolsOpen)}
              style={styles.textAction}
            >
              <AppText tone="primary" variant="footnote" style={styles.link}>
                {t(
                  toolsOpen ? 'familyPlus.hideScenes' : 'familyPlus.showScenes',
                )}
              </AppText>
            </Pressable>
          </View>
          {toolsOpen ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={onServerMode}
                style={styles.textAction}
              >
                <AppText
                  tone="secondary"
                  variant="footnote"
                  style={styles.link}
                >
                  {t('familyPlus.readLocal')}
                </AppText>
              </Pressable>
              <AppText tone="secondary" variant="footnote">
                {t(
                  mode === 'preview'
                    ? 'familyPlus.previewNotice'
                    : 'familyPlus.localReadInfo',
                )}
              </AppText>
              <View style={styles.options}>
                {familyPlusPreviewScenes.map((item) => (
                  <PreviewOption
                    key={item}
                    selected={scene === item}
                    label={t(`familyPlus.scenes.${item}`)}
                    onPress={() => onSceneChange(item)}
                  />
                ))}
              </View>
              {mode === 'preview' && initialRole === 'owner' && familyReady ? (
                <>
                  <AppText tone="secondary" variant="footnote">
                    {t('familyPlus.rolePreview')}
                  </AppText>
                  <View style={styles.options}>
                    {(['owner', 'member', 'viewer'] as const).map((item) => (
                      <PreviewOption
                        key={item}
                        selected={role === item}
                        label={t(`family.roles.${item}`)}
                        onPress={() => setRole(item)}
                      />
                    ))}
                  </View>
                </>
              ) : null}
            </>
          ) : null}
        </View>
      )}

      {effectiveScene === 'loading' ? (
        <View accessibilityRole="progressbar" style={styles.stateNotice}>
          <ActivityIndicator color={lightColors.primary} />
          <AppText tone="secondary">{t('familyPlus.loading')}</AppText>
        </View>
      ) : ['empty', 'error', 'offline'].includes(effectiveScene) ? (
        <View accessibilityLiveRegion="polite" style={styles.stateNotice}>
          <AppText variant="headline">
            {t(`familyPlus.scenes.${effectiveScene}`)}
          </AppText>
          <AppText tone="secondary">
            {t(
              mode === 'server' && effectiveScene === 'error'
                ? billing
                  ? 'familyPlus.purchase.summaryUnavailable'
                  : 'familyPlus.localNotReady'
                : `familyPlus.dataState.${effectiveScene}`,
            )}
          </AppText>
          {effectiveScene !== 'empty' ? (
            <AppButton
              variant="secondary"
              label={t('familyPlus.retry')}
              onPress={() => {
                if (familyError) retryFamily();
                else if (mode === 'server') onServerRetry?.();
                else onSceneChange('unavailable');
              }}
            />
          ) : null}
        </View>
      ) : (
        <FamilyPlusDetails
          snapshot={snapshot}
          role={
            familyReady
              ? mode === 'server'
                ? (serverRole ?? null)
                : previewRole
              : null
          }
          previewActions={mode === 'preview'}
          period={period}
          onSelectPeriod={setPeriod}
          onAction={onAction}
          billing={billing}
        />
      )}

      <View style={styles.section}>
        <AppText accessibilityRole="header" variant="title3">
          {t('familyPlus.compareTitle')}
        </AppText>
        <View style={styles.comparisonRow}>
          <View style={styles.featureColumn} />
          <AppText style={styles.planColumn} variant="headline">
            Free
          </AppText>
          <AppText style={styles.planColumn} variant="headline">
            Family Plus
          </AppText>
        </View>
        {(['space', 'video', 'care'] as const).map((feature) => (
          <View key={feature} style={styles.comparisonRow}>
            <AppText variant="subheadline" style={styles.featureColumn}>
              {t(`familyPlus.features.${feature}`)}
            </AppText>
            <AppText
              tone="secondary"
              variant="subheadline"
              style={styles.planColumn}
            >
              {t(`familyPlus.free.${feature}`)}
            </AppText>
            <AppText variant="subheadline" style={styles.planColumn}>
              {t(`familyPlus.plus.${feature}`)}
            </AppText>
          </View>
        ))}
        <AppText tone="secondary" variant="footnote">
          {t('familyPlus.coreFree')}
        </AppText>
      </View>

      <View style={styles.legal}>
        <View style={styles.legalGroup}>
          <AppText accessibilityRole="header" variant="subheadline">
            {t('familyPlus.legal.video')}
          </AppText>
          <AppText tone="secondary" variant="footnote">
            {t('familyPlus.videoLimits')}
          </AppText>
          <AppText tone="secondary" variant="footnote">
            {t('familyPlus.storage.videoCounting')}
          </AppText>
        </View>
        <View style={styles.legalGroup}>
          <AppText accessibilityRole="header" variant="subheadline">
            {t('familyPlus.legal.subscription')}
          </AppText>
          <AppText tone="secondary" variant="footnote">
            {t('familyPlus.renewal')}
          </AppText>
        </View>
        <View style={styles.legalGroup}>
          <AppText accessibilityRole="header" variant="subheadline">
            {t('familyPlus.legal.payer')}
          </AppText>
          <AppText tone="secondary" variant="footnote">
            {t('familyPlus.payer')}
          </AppText>
        </View>
        <View style={styles.legalGroup}>
          <AppText accessibilityRole="header" variant="subheadline">
            {t('familyPlus.legal.links')}
          </AppText>
          <View style={styles.options}>
            {(['terms', 'privacy'] as const).map((kind) => (
              <Pressable
                key={kind}
                accessibilityRole="link"
                onPress={() => openLegal(kind)}
                style={styles.textAction}
              >
                <AppText
                  tone="secondary"
                  variant="footnote"
                  style={styles.link}
                >
                  {t(`about.${kind}`)}
                </AppText>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Screen>
  );
}

function PreviewOption({
  label,
  selected,
  disabled = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.previewOption, selected && styles.previewSelected]}
    >
      <AppText variant="footnote">{label}</AppText>
    </Pressable>
  );
}

export function FamilyPlusDetails({
  snapshot,
  role,
  period,
  onSelectPeriod,
  onAction,
  previewActions = true,
  billing,
}: {
  snapshot: FamilyPlusSnapshot;
  role: FamilyPlusRole;
  period: FamilyPlusPeriod;
  onSelectPeriod: (period: FamilyPlusPeriod) => void;
  onAction: (action: FamilyPlusAction) => void;
  previewActions?: boolean;
  billing?: FamilyPlusPurchases | undefined;
}) {
  const { t, i18n } = useTranslation();
  const { isWide, fontScale } = useContentLayout();
  const identity = familyPlusIdentity(
    snapshot,
    canUseFamilyPlusPreview(__DEV__, process.env.EXPO_PUBLIC_SUPABASE_URL),
  );
  const canSelect =
    (previewActions || Boolean(billing)) &&
    canSelectFamilyPlusPlan(role, identity.status);
  const wide = isWide && fontScale < 1.4;
  const referencePrices = snapshot.prices.some(
    (price) => price.source === 'development-reference',
  );
  const transition = familyPlusTransition(snapshot);
  return (
    <>
      <View style={styles.status}>
        <View style={styles.identityHeading}>
          <AppText
            accessibilityRole="header"
            variant="headline"
            style={styles.identityTitle}
          >
            {t(`familyPlus.status.${identity.status}`)}
          </AppText>
          <FamilyPlusBadge snapshot={snapshot} />
        </View>
        <AppText tone="secondary" variant="subheadline">
          {t(`familyPlus.statusBody.${identity.status}`)}
        </AppText>
        {transition ? (
          <AppText tone="secondary" variant="footnote">
            {transition.expired
              ? t('familyPlus.transitionEnded')
              : t('familyPlus.transitionDeadline', {
                  count: transition.remainingDays,
                  date: new Intl.DateTimeFormat(
                    i18n.resolvedLanguage ?? 'zh-HK',
                    { dateStyle: 'medium', timeStyle: 'short' },
                  ).format(new Date(transition.endsAt)),
                })}
          </AppText>
        ) : null}
      </View>
      <FamilyStorageSummary snapshot={snapshot} />
      <FamilyPlusBenefits title={familyPlusBenefitsTitle(role, identity)} />
      {canSelect ? (
        <View style={styles.section}>
          <AppText accessibilityRole="header" variant="title3">
            {t('familyPlus.choosePlan')}
          </AppText>
          <AppText tone="secondary" variant="footnote">
            {t(
              referencePrices
                ? 'familyPlus.referencePrices'
                : 'familyPlus.storePrices',
            )}
          </AppText>
          <View style={[styles.plans, wide && styles.widePlans]}>
            {(['monthly', 'yearly'] as const).map((item) => {
              const price = familyPlusPrice(snapshot.prices, item);
              const selected = period === item;
              return (
                <Pressable
                  key={item}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => onSelectPeriod(item)}
                  style={[
                    styles.plan,
                    wide && styles.grow,
                    selected && styles.selectedPlan,
                  ]}
                >
                  <View style={styles.planHeading}>
                    <AppText variant="headline" style={styles.grow}>
                      {t(`familyPlus.period.${item}`)}
                    </AppText>
                    <Ionicons
                      accessible={false}
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      color={
                        selected
                          ? lightColors.primary
                          : lightColors.textSecondary
                      }
                      size={22}
                    />
                  </View>
                  <AppText variant="title3">
                    {price
                      ? price.priceString
                      : t('familyPlus.priceUnavailable')}
                    {price ? ` / ${t(`familyPlus.unit.${item}`)}` : ''}
                  </AppText>
                  <AppText tone="secondary" variant="footnote">
                    {t(`familyPlus.charge.${item}`)}
                  </AppText>
                  {item === 'yearly' &&
                  price?.source === 'development-reference' ? (
                    <AppText tone="secondary" variant="footnote">
                      {t('familyPlus.yearlySaving')}
                    </AppText>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          <AppButton
            variant="secondary"
            label={t(
              previewActions
                ? 'familyPlus.previewPurchase'
                : 'familyPlus.purchase.buy',
            )}
            loading={billing?.busy ?? false}
            disabled={
              !previewActions &&
              (!billing?.ready ||
                billing.blocked ||
                !familyPlusPrice(snapshot.prices, period))
            }
            onPress={() => onAction('purchase')}
          />
        </View>
      ) : null}
      {billing ? (
        <View style={styles.section}>
          <AppText tone="secondary" variant="footnote">
            {t(
              !billing.ready
                ? 'familyPlus.purchase.notReady'
                : billing.blocked
                  ? 'familyPlus.purchase.blocked'
                  : 'familyPlus.purchase.storeNotice',
            )}
          </AppText>
          {role === 'owner' && !billing.blocked ? (
            <AppButton
              variant="ghost"
              disabled={billing.busy || billing.productsLoading}
              label={t('familyPlus.purchase.reload')}
              onPress={billing.reload}
            />
          ) : null}
          {billing.message ? (
            <AppText accessibilityLiveRegion="polite" tone="secondary">
              {t(`familyPlus.purchase.${billing.message}`)}
            </AppText>
          ) : null}
          {role === 'owner' ? (
            <AppButton
              variant="ghost"
              disabled={billing.busy || !billing.managementReady}
              label={t('familyPlus.purchase.refresh')}
              onPress={() => void billing.action('refresh', period)}
            />
          ) : null}
        </View>
      ) : null}
      {role === 'owner' && (previewActions || billing) ? (
        <View style={styles.management}>
          {(['restore', 'manage'] as const).map((action) => (
            <Pressable
              key={action}
              accessibilityRole="button"
              disabled={
                billing ? billing.busy || !billing.managementReady : false
              }
              accessibilityState={{
                disabled: billing
                  ? billing.busy || !billing.managementReady
                  : false,
              }}
              onPress={() => onAction(action)}
              style={styles.textAction}
            >
              <AppText
                tone="secondary"
                variant="subheadline"
                style={styles.link}
              >
                {t(
                  previewActions
                    ? `familyPlus.${action}`
                    : `familyPlus.purchase.${action}`,
                )}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : role && role !== 'owner' ? (
        <AppText tone="secondary" variant="subheadline">
          {t('familyPlus.ownerOnly')}
        </AppText>
      ) : null}
    </>
  );
}

function FamilyPlusBenefits({
  title,
}: {
  title: ReturnType<typeof familyPlusBenefitsTitle>;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <AppText accessibilityRole="header" variant="title3">
        {t(`familyPlus.benefits.${title}`)}
      </AppText>
      {(['space', 'video', 'sharing'] as const).map((benefit) => (
        <View key={benefit} style={styles.benefitRow}>
          <Ionicons
            accessible={false}
            name="checkmark"
            color={lightColors.secondary}
            size={20}
          />
          <AppText style={styles.grow} variant="callout">
            {t(`familyPlus.benefits.${benefit}`)}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xxl, paddingTop: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  intro: { gap: spacing.sm },
  section: { gap: spacing.md },
  previewNotice: {
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    // Keep the other screen sections at 24pt; this notice leads into status at 16pt.
    marginBottom: -spacing.sm,
    gap: spacing.sm,
  },
  previewSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stackedSummary: { flexDirection: 'column', alignItems: 'flex-start' },
  textAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  previewOption: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: radius.md,
  },
  previewSelected: {
    borderColor: lightColors.secondary,
    backgroundColor: lightColors.secondarySoft,
  },
  status: {
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: lightColors.border,
    paddingBottom: spacing.lg,
  },
  identityHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  identityTitle: { flexShrink: 1, maxWidth: '100%' },
  stateNotice: { gap: spacing.md, paddingVertical: spacing.lg },
  plans: { gap: spacing.md },
  widePlans: { flexDirection: 'row', alignItems: 'stretch' },
  plan: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: lightColors.border,
    backgroundColor: lightColors.surface,
  },
  selectedPlan: {
    borderColor: lightColors.primary,
    backgroundColor: lightColors.primarySoft,
  },
  planHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  management: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: lightColors.border,
  },
  featureColumn: { flex: 1.2, minWidth: 0 },
  planColumn: { flex: 1, minWidth: 0 },
  legal: { gap: spacing.lg },
  legalGroup: { gap: spacing.xs },
  link: { textDecorationLine: 'underline' },
});
