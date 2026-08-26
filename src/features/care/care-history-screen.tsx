import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { EmptyState } from '@/components/empty-state';
import { useFeedback } from '@/components/feedback-provider';
import { IconButton } from '@/components/icon-button';
import { useAuth } from '@/features/auth/auth-context';
import { usePetMembers } from '@/features/family/family-queries';
import { PetSwitcherModal } from '@/features/pets/components/pet-switcher-modal';
import { useCurrentPet } from '@/features/pets/use-current-pet';
import { lightColors, layout, radius, spacing } from '@/theme';
import type { CareLog } from '@/types/database';

import { formatCareDate, formatCareTime, getCareDateKind } from './care-date';
import {
  useCareHistory,
  useCarePerformers,
  useDeleteCareLog,
} from './care-queries';
import { careTypeIcons } from './care-types';

type TimelineItem =
  | { id: string; kind: 'header'; label: string }
  | { id: string; kind: 'log'; log: CareLog };

export default function CareHistoryScreen() {
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  const { user } = useAuth();
  const petsState = useCurrentPet();
  const petId = petsState.currentPetId;
  const historyQuery = useCareHistory(petId);
  const performersQuery = useCarePerformers(petId);
  const membersQuery = usePetMembers(petId);
  const deleteCare = useDeleteCareLog();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const logs = useMemo(
    () => historyQuery.data?.pages.flatMap((page) => page.logs) ?? [],
    [historyQuery.data],
  );
  const timeline = useMemo(
    () => createTimeline(logs, i18n.language, t),
    [i18n.language, logs, t],
  );
  const performerNames = useMemo(
    () =>
      Object.fromEntries(
        (performersQuery.data ?? []).map((p) => [p.userId, p.displayName]),
      ),
    [performersQuery.data],
  );
  const isOwner = membersQuery.data?.some(
    (member) => member.userId === user?.id && member.role === 'owner',
  );
  const error =
    petsState.isError || historyQuery.isError || performersQuery.isError;

  const confirmDelete = (log: CareLog) => {
    Alert.alert(t('care.delete.title'), t('care.delete.body'), [
      { style: 'cancel', text: t('common.cancel') },
      {
        style: 'destructive',
        text: t('care.delete.action'),
        onPress: () => {
          void deleteCare
            .mutateAsync(log.id)
            .catch(() => showFeedback(t('care.errors.delete'), 'error'));
        },
      },
    ]);
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <FlatList
        ListEmptyComponent={
          error ? (
            <View style={styles.state}>
              <AppText tone="error">{t('care.errors.load')}</AppText>
              <AppButton
                label={t('common.retry')}
                onPress={() => void historyQuery.refetch()}
              />
            </View>
          ) : petsState.currentPet ? (
            <View style={styles.state}>
              <EmptyState
                actionLabel={t('care.empty.action')}
                body={t('care.empty.body', { name: petsState.currentPet.name })}
                icon="heart-outline"
                onActionPress={() => router.push('/create')}
                title={t('care.empty.title')}
              />
            </View>
          ) : null
        }
        ListFooterComponent={
          historyQuery.isFetchingNextPage ? (
            <ActivityIndicator color={lightColors.primary} />
          ) : null
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <IconButton
                accessibilityLabel={t('common.back')}
                icon="chevron-back"
                onPress={() => router.back()}
              />
              <View style={styles.titleCopy}>
                <AppText accessibilityRole="header" variant="largeTitle">
                  {t('care.history.title')}
                </AppText>
                <AppText tone="secondary" variant="footnote">
                  {t('care.history.subtitle')}
                </AppText>
              </View>
            </View>
            {petsState.currentPet ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setSwitcherOpen(true)}
                style={({ pressed }) => [
                  styles.petSelector,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  color={lightColors.secondary}
                  name="paw-outline"
                  size={20}
                />
                <AppText style={styles.petName} variant="headline">
                  {petsState.currentPet.name}
                </AppText>
                <Ionicons
                  color={lightColors.textSecondary}
                  name="chevron-down"
                  size={18}
                />
              </Pressable>
            ) : null}
          </View>
        }
        contentContainerStyle={styles.content}
        data={timeline}
        initialNumToRender={10}
        keyboardDismissMode="on-drag"
        key={petId ?? 'none'}
        keyExtractor={(item) => item.id}
        maxToRenderPerBatch={10}
        onEndReached={() => {
          if (historyQuery.hasNextPage && !historyQuery.isFetchingNextPage)
            void historyQuery.fetchNextPage();
        }}
        onEndReachedThreshold={0.35}
        refreshControl={
          <RefreshControl
            refreshing={
              historyQuery.isRefetching && !historyQuery.isFetchingNextPage
            }
            onRefresh={() => {
              void historyQuery.refetch();
              void performersQuery.refetch();
            }}
            tintColor={lightColors.primary}
          />
        }
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <AppText
              style={styles.dateHeader}
              tone="secondary"
              variant="headline"
            >
              {item.label}
            </AppText>
          ) : (
            <CareRow
              canDelete={Boolean(isOwner || item.log.performed_by === user?.id)}
              canEdit={item.log.performed_by === user?.id}
              log={item.log}
              onDelete={() => confirmDelete(item.log)}
              onEdit={() => router.push(`/care/${item.log.id}/edit` as Href)}
              performerName={
                performerNames[item.log.performed_by] ??
                t('family.members.formerMember')
              }
            />
          )
        }
        showsVerticalScrollIndicator={false}
        style={styles.list}
        updateCellsBatchingPeriod={50}
        windowSize={7}
      />
      <PetSwitcherModal
        currentPetId={petId}
        onAddPet={() => {
          setSwitcherOpen(false);
          router.push('/pets/new');
        }}
        onClose={() => setSwitcherOpen(false)}
        onSelectPet={(id) => {
          petsState.setCurrentPetId(id);
          setSwitcherOpen(false);
        }}
        pets={petsState.pets}
        visible={switcherOpen}
      />
    </SafeAreaView>
  );
}

function createTimeline(
  logs: CareLog[],
  locale: string,
  t: TFunction,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  let lastDate = '';
  for (const log of logs) {
    if (log.local_date !== lastDate) {
      const kind = getCareDateKind(log.local_date);
      items.push({
        id: `date-${log.local_date}`,
        kind: 'header',
        label:
          kind === 'today'
            ? t('journal.today')
            : kind === 'yesterday'
              ? t('journal.yesterday')
              : formatCareDate(log.local_date, locale),
      });
      lastDate = log.local_date;
    }
    items.push({ id: log.id, kind: 'log', log });
  }
  return items;
}

function CareRow({
  canDelete,
  canEdit,
  log,
  onDelete,
  onEdit,
  performerName,
}: {
  canDelete: boolean;
  canEdit: boolean;
  log: CareLog;
  onDelete: () => void;
  onEdit: () => void;
  performerName: string;
}) {
  const { i18n, t } = useTranslation();
  return (
    <View style={styles.logRow}>
      <View style={styles.logIcon}>
        <Ionicons
          color={lightColors.secondary}
          name={careTypeIcons[log.care_type]}
          size={22}
        />
      </View>
      <View style={styles.logCopy}>
        <View style={styles.logTitleRow}>
          <AppText variant="headline">
            {t(`care.types.${log.care_type}`)}
          </AppText>
          <AppText tone="tertiary" variant="footnote">
            {formatCareTime(log.occurred_at, log.time_zone, i18n.language)}
          </AppText>
        </View>
        <AppText tone="secondary" variant="footnote">
          {t('care.performedBy', { name: performerName })}
        </AppText>
        {log.duration_minutes ? (
          <AppText tone="secondary" variant="footnote">
            {t('care.durationMinutes', { count: log.duration_minutes })}
          </AppText>
        ) : null}
        {log.note ? (
          <AppText numberOfLines={3} style={styles.note}>
            {log.note}
          </AppText>
        ) : null}
        {canEdit || canDelete ? (
          <View style={styles.actions}>
            {canEdit ? (
              <Pressable onPress={onEdit}>
                <AppText tone="brand" variant="footnote">
                  {t('common.edit')}
                </AppText>
              </Pressable>
            ) : null}
            {canDelete ? (
              <Pressable onPress={onDelete}>
                <AppText tone="error" variant="footnote">
                  {t('care.delete.action')}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: lightColors.background },
  list: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.huge,
    paddingHorizontal: spacing.lg,
  },
  header: { gap: spacing.lg, paddingBottom: spacing.sm },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  titleCopy: { flex: 1, gap: spacing.xxs },
  petSelector: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: lightColors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  petName: { flex: 1 },
  pressed: { opacity: 0.62 },
  state: { paddingVertical: spacing.huge },
  dateHeader: { marginTop: spacing.md },
  logRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: lightColors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  logIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: lightColors.secondarySoft,
  },
  logCopy: { flex: 1, gap: spacing.xs },
  logTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  note: { marginTop: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
});
