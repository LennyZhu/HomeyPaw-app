import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { EmptyState } from '@/components/empty-state';
import { IconButton } from '@/components/icon-button';
import { Screen } from '@/components/screen';
import { formatCareTime, getLocalDateOnly } from '@/features/care/care-date';
import { useCarePerformers, useTodayCare } from '@/features/care/care-queries';
import { careTypeIcons } from '@/features/care/care-types';
import {
  usePetMembers,
  usePetPostAuthors,
} from '@/features/family/family-queries';
import { PetAvatar } from '@/features/pets/components/pet-avatar';
import { PetSwitcherModal } from '@/features/pets/components/pet-switcher-modal';
import { formatDateOnly, getCompanionDays } from '@/features/pets/pet-dates';
import { getPetSummaryLabel } from '@/features/pets/pet-display';
import { usePet } from '@/features/pets/pet-queries';
import { useCurrentPet } from '@/features/pets/use-current-pet';
import { useCareTaskOccurrences } from '@/features/reminders/care-task-queries';
import { PostMediaPreview } from '@/features/posts/components/post-media-preview';
import {
  type PostWithMedia,
  usePetMemory,
  usePost,
  usePostMediaUrls,
  usePosts,
} from '@/features/posts/post-queries';
import { lightColors, radius, spacing } from '@/theme';
import type { CareLog } from '@/types/database';

export default function HomeScreen() {
  const router = useRouter();
  const { i18n, t } = useTranslation();
  const petsState = useCurrentPet();
  const petId = petsState.currentPetId;
  const petQuery = usePet(petId ?? '');
  const postsQuery = usePosts(petId);
  const membersQuery = usePetMembers(petId);
  const authorsQuery = usePetPostAuthors(petId);
  const memoryQuery = usePetMemory(petId);
  const [localToday, setLocalToday] = useState(getLocalDateOnly);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const reminderWindow = useMemo(() => {
    const [year = 1970, month = 1, day = 1] = localToday.split('-').map(Number);
    const start = new Date(year, month - 1, day);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { end, start };
  }, [localToday]);
  const reminderQuery = useCareTaskOccurrences(
    petId,
    reminderWindow.start,
    reminderWindow.end,
  );
  const todayCareQuery = useTodayCare(petId, localToday);
  const carePerformersQuery = useCarePerformers(petId);
  const memoryPostQuery = usePost(memoryQuery.data?.postId ?? '');
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pet = petQuery.data ?? petsState.currentPet;
  const recentPosts = useMemo(
    () => postsQuery.data?.pages[0]?.posts.slice(0, 3) ?? [],
    [postsQuery.data],
  );
  const memoryPost = memoryPostQuery.data ?? null;
  const previewPaths = useMemo(
    () =>
      [...recentPosts, ...(memoryPost ? [memoryPost] : [])].flatMap((post) =>
        post.post_media.slice(0, 4).map((media) => media.storage_path),
      ),
    [memoryPost, recentPosts],
  );
  const mediaUrlsQuery = usePostMediaUrls(previewPaths);
  const lastMediaRecoveryAt = useRef(0);
  const recoverMediaUrls = useCallback(() => {
    if (Date.now() - lastMediaRecoveryAt.current < 60_000) return;
    lastMediaRecoveryAt.current = Date.now();
    void mediaUrlsQuery.refetch();
  }, [mediaUrlsQuery]);
  const authorNames = useMemo(
    () =>
      Object.fromEntries(
        (authorsQuery.data ?? []).map((author) => [
          author.userId,
          author.displayName,
        ]),
      ),
    [authorsQuery.data],
  );
  const companionDays = pet ? getCompanionDays(pet.adoption_date) : null;
  const carePerformerNames = useMemo(
    () =>
      Object.fromEntries(
        (carePerformersQuery.data ?? []).map((performer) => [
          performer.userId,
          performer.displayName,
        ]),
      ),
    [carePerformersQuery.data],
  );
  const reminderAttentionCount = useMemo(
    () =>
      (reminderQuery.data ?? []).filter(
        (occurrence) =>
          !occurrence.completion_id &&
          new Date(occurrence.scheduled_for) <= currentTime,
      ).length,
    [currentTime, reminderQuery.data],
  );

  const refreshHome = async () => {
    if (!petId) return;
    setLocalToday(getLocalDateOnly());
    setCurrentTime(new Date());
    setIsRefreshing(true);
    await Promise.all([
      petQuery.refetch(),
      postsQuery.refetch(),
      membersQuery.refetch(),
      authorsQuery.refetch(),
      memoryQuery.refetch(),
      memoryPostQuery.refetch(),
      todayCareQuery.refetch(),
      carePerformersQuery.refetch(),
      reminderQuery.refetch(),
    ]);
    setIsRefreshing(false);
  };

  useFocusEffect(
    useCallback(() => {
      setLocalToday(getLocalDateOnly());
      setCurrentTime(new Date());
    }, []),
  );

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Screen
      contentContainerStyle={styles.screenContent}
      refreshControl={
        <RefreshControl
          onRefresh={() => void refreshHome()}
          refreshing={isRefreshing}
          tintColor={lightColors.primary}
        />
      }
      scroll
    >
      <View style={styles.topBar}>
        <View style={styles.greetingBlock}>
          <AppText accessibilityRole="header" variant="largeTitle">
            {t(getGreetingKey())}
          </AppText>
          <AppText tone="secondary" variant="subheadline">
            {t('home.greetingSubtitle')}
          </AppText>
        </View>
        <View style={styles.reminderButton}>
          <IconButton
            accessibilityLabel={
              reminderAttentionCount > 0
                ? t('reminders.badgeAccessibility', {
                    count: reminderAttentionCount,
                  })
                : t('home.notifications')
            }
            accessibilityValue={
              reminderAttentionCount > 0
                ? { text: String(reminderAttentionCount) }
                : { text: '0' }
            }
            icon="notifications-outline"
            onPress={() => router.push('/reminders')}
          />
          {reminderAttentionCount > 0 ? (
            <View style={styles.reminderBadge}>
              <AppText tone="onPrimary" variant="caption">
                {Math.min(reminderAttentionCount, 9)}
                {reminderAttentionCount > 9 ? '+' : ''}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>

      {petsState.isPending ? <HomeSkeleton /> : null}

      {petsState.isError ? (
        <View style={styles.errorState}>
          <AppText tone="error">{t('pets.errors.load')}</AppText>
          <AppButton
            label={t('common.retry')}
            onPress={() => void petsState.refetch()}
            variant="secondary"
          />
        </View>
      ) : null}

      {petsState.isSuccess && !pet ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            actionLabel={t('pets.empty.action')}
            body={t('pets.empty.homeBody')}
            icon="paw-outline"
            onActionPress={() => router.push('/pets/new')}
            title={t('pets.empty.homeTitle')}
          />
          <AppButton
            label={t('family.join.action')}
            onPress={() => router.push('/join-family' as Href)}
            variant="secondary"
          />
        </View>
      ) : null}

      {pet ? (
        <>
          <Pressable
            accessibilityLabel={t('home.changePet')}
            accessibilityRole="button"
            onPress={() => setIsSwitcherOpen(true)}
            style={({ pressed }) => [styles.petHero, pressed && styles.pressed]}
          >
            <PetAvatar
              accessibilityLabel={t('pets.avatar.accessibility', {
                name: pet.name,
              })}
              avatarPath={pet.avatar_path}
              name={pet.name}
              size={82}
            />
            <View style={styles.petDetails}>
              <View style={styles.petNameRow}>
                <AppText variant="title1">{pet.name}</AppText>
                <Ionicons
                  color={lightColors.textSecondary}
                  name="chevron-down"
                  size={20}
                />
              </View>
              <AppText tone="secondary" variant="subheadline">
                {getPetSummaryLabel(pet, t)}
              </AppText>
            </View>
          </Pressable>

          {companionDays !== null ? (
            <View style={styles.companionRow}>
              <View style={styles.companionIcon}>
                <Ionicons
                  color={lightColors.secondary}
                  name="heart-outline"
                  size={20}
                />
              </View>
              <AppText variant="headline">
                {t('home.companionDays', {
                  days: new Intl.NumberFormat(i18n.language).format(
                    companionDays,
                  ),
                })}
              </AppText>
            </View>
          ) : null}

          <HomeSection
            action={t('common.seeAll')}
            onAction={() => router.push('/care')}
            title={t('care.home.title')}
          >
            {todayCareQuery.isPending ? (
              <SectionSkeleton />
            ) : (todayCareQuery.data?.length ?? 0) > 0 ? (
              <View style={styles.careList}>
                {todayCareQuery.data?.slice(0, 3).map((log) => (
                  <TodayCareRow
                    key={log.id}
                    log={log}
                    performerName={
                      carePerformerNames[log.performed_by] ??
                      t('family.members.formerMember')
                    }
                  />
                ))}
              </View>
            ) : (
              <AppText tone="secondary">{t('care.home.empty')}</AppText>
            )}
            <AppButton
              label={t('care.home.add')}
              onPress={() =>
                router.push({ pathname: '/create', params: { mode: 'care' } })
              }
              variant="secondary"
            />
          </HomeSection>

          {postsQuery.isError ||
          membersQuery.isError ||
          authorsQuery.isError ||
          todayCareQuery.isError ||
          carePerformersQuery.isError ||
          reminderQuery.isError ||
          memoryQuery.isError ? (
            <AppText
              style={styles.partialError}
              tone="error"
              variant="footnote"
            >
              {t('home.errors.refresh')}
            </AppText>
          ) : null}

          <HomeSection
            action={recentPosts.length > 0 ? t('common.seeAll') : undefined}
            onAction={() => router.push('/journal')}
            title={t('home.recentActivity')}
          >
            {postsQuery.isPending ? (
              <SectionSkeleton />
            ) : recentPosts.length > 0 ? (
              <View style={styles.activityList}>
                {recentPosts.map((post) => (
                  <RecentActivity
                    authorName={authorNames[post.author_id]}
                    key={post.id}
                    mediaUrls={mediaUrlsQuery.data ?? {}}
                    onMediaError={recoverMediaUrls}
                    onPress={() => router.push(`/posts/${post.id}` as Href)}
                    post={post}
                  />
                ))}
              </View>
            ) : (
              <AppText tone="secondary">{t('home.noActivity')}</AppText>
            )}
          </HomeSection>

          <HomeSection
            title={
              memoryQuery.data?.kind === 'on_this_day'
                ? t('home.memory.onThisDay')
                : t('home.memory.recent')
            }
          >
            {memoryQuery.isPending ||
            (memoryQuery.data && memoryPostQuery.isPending) ? (
              <SectionSkeleton />
            ) : memoryPost ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/posts/${memoryPost.id}` as Href)}
                style={({ pressed }) => [
                  styles.memory,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.memoryMeta}>
                  <Ionicons
                    color={lightColors.secondary}
                    name="sparkles-outline"
                    size={18}
                  />
                  <AppText tone="secondary" variant="footnote">
                    {memoryQuery.data?.kind === 'on_this_day'
                      ? t('home.memory.yearsAgo', {
                          count: memoryQuery.data.yearsAgo ?? 1,
                        })
                      : formatDateOnly(memoryPost.event_date, i18n.language)}
                  </AppText>
                </View>
                <PostMediaPreview
                  media={memoryPost.post_media}
                  mediaUrls={mediaUrlsQuery.data ?? {}}
                  onImageError={recoverMediaUrls}
                />
                {memoryPost.content ? (
                  <AppText numberOfLines={3}>{memoryPost.content}</AppText>
                ) : null}
              </Pressable>
            ) : (
              <AppText tone="secondary">{t('home.memory.empty')}</AppText>
            )}
          </HomeSection>

          <HomeSection title={t('home.family')}>
            {membersQuery.isPending ? (
              <SectionSkeleton />
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/pets/${pet.id}/members` as Href)}
                style={({ pressed }) => [
                  styles.familyRow,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.memberAvatars}>
                  {(membersQuery.data ?? [])
                    .slice(0, 3)
                    .map((member, index) => (
                      <View
                        key={member.userId}
                        style={[
                          styles.memberAvatar,
                          { marginLeft: index === 0 ? 0 : -8 },
                        ]}
                      >
                        <AppText variant="caption">
                          {member.displayName.trim().charAt(0).toUpperCase()}
                        </AppText>
                      </View>
                    ))}
                </View>
                <View style={styles.familyCopy}>
                  <AppText variant="headline">
                    {(membersQuery.data?.length ?? 0) > 1
                      ? t('home.familyCount', {
                          count: membersQuery.data?.length ?? 0,
                        })
                      : t('home.inviteFamily', { name: pet.name })}
                  </AppText>
                  <AppText tone="secondary" variant="footnote">
                    {t('home.viewFamily')}
                  </AppText>
                </View>
                <Ionicons
                  color={lightColors.textTertiary}
                  name="chevron-forward"
                  size={18}
                />
              </Pressable>
            )}
          </HomeSection>

          <AppButton
            label={t('home.viewJournal')}
            onPress={() => router.push('/journal')}
            style={styles.journalButton}
            variant="secondary"
          />

          <PetSwitcherModal
            currentPetId={petId}
            onAddPet={() => {
              setIsSwitcherOpen(false);
              router.push('/pets/new');
            }}
            onClose={() => setIsSwitcherOpen(false)}
            onSelectPet={(selectedPetId) => {
              petsState.setCurrentPetId(selectedPetId);
              setIsSwitcherOpen(false);
            }}
            pets={petsState.pets}
            visible={isSwitcherOpen}
          />
        </>
      ) : null}
    </Screen>
  );
}

function HomeSection({
  action,
  children,
  onAction,
  title,
}: {
  action?: string | undefined;
  children: React.ReactNode;
  onAction?: () => void;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <AppText variant="title2">{title}</AppText>
        {action && onAction ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onAction}>
            <AppText tone="brand" variant="footnote">
              {action}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function RecentActivity({
  authorName,
  mediaUrls,
  onMediaError,
  onPress,
  post,
}: {
  authorName: string | undefined;
  mediaUrls: Record<string, string>;
  onMediaError: () => void;
  onPress: () => void;
  post: PostWithMedia;
}) {
  const { i18n, t } = useTranslation();
  const firstMedia = post.post_media[0];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.activity, pressed && styles.pressed]}
    >
      {firstMedia ? (
        <Image
          accessibilityLabel={t('posts.photos.entryPhoto', { position: 1 })}
          cachePolicy="memory-disk"
          contentFit="cover"
          onError={onMediaError}
          recyclingKey={firstMedia.id}
          source={mediaUrls[firstMedia.storage_path] ?? null}
          style={styles.activityImage}
          transition={140}
        />
      ) : (
        <View style={styles.activityIcon}>
          <Ionicons
            color={lightColors.secondary}
            name="book-outline"
            size={20}
          />
        </View>
      )}
      <View style={styles.activityCopy}>
        <AppText numberOfLines={1} variant="headline">
          {post.content || t(`posts.tags.${post.tag ?? 'other'}`)}
        </AppText>
        <AppText numberOfLines={1} tone="secondary" variant="footnote">
          {authorName ?? t('family.members.formerMember')} ·{' '}
          {formatDateOnly(post.event_date, i18n.language)}
        </AppText>
      </View>
      <Ionicons
        color={lightColors.textTertiary}
        name="chevron-forward"
        size={18}
      />
    </Pressable>
  );
}

function TodayCareRow({
  log,
  performerName,
}: {
  log: CareLog;
  performerName: string;
}) {
  const { i18n, t } = useTranslation();
  return (
    <View style={styles.careRow}>
      <View style={styles.careIcon}>
        <Ionicons
          color={lightColors.secondary}
          name={careTypeIcons[log.care_type]}
          size={20}
        />
      </View>
      <View style={styles.careCopy}>
        <AppText variant="headline">{t(`care.types.${log.care_type}`)}</AppText>
        <AppText numberOfLines={1} tone="secondary" variant="footnote">
          {t('care.home.meta', {
            name: performerName,
            time: formatCareTime(log.occurred_at, log.time_zone, i18n.language),
          })}
        </AppText>
        {log.duration_minutes ? (
          <AppText tone="secondary" variant="footnote">
            {t('care.durationMinutes', { count: log.duration_minutes })}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

function HomeSkeleton() {
  return (
    <View accessibilityLabel="Loading home" style={styles.skeletonWrap}>
      <View style={[styles.skeleton, styles.skeletonHero]} />
      <View style={[styles.skeleton, styles.skeletonLine]} />
      <View style={[styles.skeleton, styles.skeletonBlock]} />
    </View>
  );
}

function SectionSkeleton() {
  return (
    <View accessibilityLabel="Loading section" style={styles.sectionSkeleton}>
      <View style={[styles.skeleton, styles.sectionSkeletonImage]} />
      <View style={styles.sectionSkeletonCopy}>
        <View style={[styles.skeleton, styles.sectionSkeletonTitle]} />
        <View style={[styles.skeleton, styles.sectionSkeletonLine]} />
      </View>
    </View>
  );
}

function getGreetingKey() {
  const hour = new Date().getHours();
  if (hour < 12) return 'home.greetings.morning';
  if (hour < 18) return 'home.greetings.afternoon';
  return 'home.greetings.evening';
}

const styles = StyleSheet.create({
  screenContent: { paddingBottom: spacing.huge, paddingTop: spacing.md },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  greetingBlock: { flex: 1, gap: spacing.xs, paddingRight: spacing.md },
  reminderButton: { position: 'relative' },
  reminderBadge: {
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    backgroundColor: lightColors.error,
    borderColor: lightColors.background,
    borderRadius: radius.full,
    borderWidth: 2,
    justifyContent: 'center',
    paddingHorizontal: 3,
    position: 'absolute',
    right: -3,
    top: -3,
  },
  emptyWrap: {
    minHeight: 420,
    flex: 1,
    marginTop: spacing.xl,
    gap: spacing.lg,
  },
  errorState: {
    alignItems: 'flex-start',
    gap: spacing.lg,
    marginTop: spacing.huge,
  },
  petHero: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.xxxl,
    paddingVertical: spacing.sm,
  },
  petDetails: { flex: 1, gap: spacing.xs },
  petNameRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  companionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  companionIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  careList: { gap: spacing.xs },
  careRow: {
    minHeight: 62,
    alignItems: 'center',
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  careIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  careCopy: { flex: 1, gap: spacing.xxs },
  section: { gap: spacing.md, marginTop: spacing.xxxl },
  sectionHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  partialError: { marginTop: spacing.lg },
  activityList: { gap: spacing.xs },
  activity: {
    minHeight: 70,
    alignItems: 'center',
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  activityImage: {
    width: 54,
    height: 54,
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.md,
  },
  activityIcon: {
    width: 54,
    height: 54,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.md,
    justifyContent: 'center',
  },
  activityCopy: { flex: 1, gap: spacing.xs },
  memory: {
    backgroundColor: lightColors.surface,
    borderRadius: radius.lg,
    gap: spacing.md,
    padding: spacing.md,
  },
  memoryMeta: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  familyRow: {
    minHeight: 72,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  memberAvatars: { flexDirection: 'row', minWidth: 42 },
  memberAvatar: {
    width: 36,
    height: 36,
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.secondarySoft,
    borderRadius: radius.full,
    borderWidth: 2,
    justifyContent: 'center',
  },
  familyCopy: { flex: 1, gap: spacing.xs },
  journalButton: { marginTop: spacing.xl },
  skeletonWrap: { gap: spacing.lg, marginTop: spacing.xxxl },
  skeleton: {
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.md,
  },
  skeletonHero: { height: 92 },
  skeletonLine: { height: 44, width: '72%' },
  skeletonBlock: { height: 92 },
  sectionSkeleton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 70,
  },
  sectionSkeletonImage: { height: 54, width: 54 },
  sectionSkeletonCopy: { flex: 1, gap: spacing.sm },
  sectionSkeletonTitle: { height: 16, width: '78%' },
  sectionSkeletonLine: { height: 12, width: '48%' },
  pressed: { opacity: 0.65 },
});
