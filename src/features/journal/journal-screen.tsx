import { contentStyles } from '@/components/content-container';
import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { LoadingView } from '@/components/loading-view';
import { useAuth } from '@/features/auth/auth-context';
import { usePetPostAuthors } from '@/features/family/family-queries';
import { parseDateOnly } from '@/features/pets/pet-dates';
import { useCurrentPet } from '@/features/pets/use-current-pet';
import { PostMediaPreview } from '@/features/posts/components/post-media-preview';
import { PostPhotoViewer } from '@/features/posts/components/post-photo-viewer';
import { PostVideoThumbnail } from '@/features/posts/components/post-video-thumbnail';
import { getRelativeDateKind } from '@/features/posts/post-date-label';
import {
  type PostWithMedia,
  usePostMediaUrls,
  usePostVideoThumbnailUrls,
  usePosts,
} from '@/features/posts/post-queries';
import { lightColors, layout, radius, spacing } from '@/theme';
import { runManualRefresh } from '@/lib/manual-refresh';

import { JournalDateFilterModal } from './components/journal-date-filter-modal';
import {
  createJournalContextKey,
  createJournalListStateKey,
  formatAccessibleJournalDateRange,
  formatCompactJournalDateRange,
  getJournalScrollOffset,
  setJournalScrollOffset,
} from './journal-browsing';
import { useJournalFilterStore } from './journal-browsing-state';
import { isJournalInitialLoading } from './manual-refresh';

type TimelineItem =
  | { id: string; kind: 'year'; label: string }
  | { id: string; kind: 'month'; label: string }
  | { id: string; kind: 'day'; label: string }
  | { id: string; kind: 'post'; post: PostWithMedia };

export default function JournalScreen() {
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const petsState = useCurrentPet();
  const petId = petsState.currentPetId;
  const journalContextKey = createJournalContextKey(user?.id, petId);
  const dateRange = useJournalFilterStore(
    (state) => state.filters[journalContextKey],
  );
  const setDateRange = useJournalFilterStore((state) => state.setFilter);
  const listStateKey = createJournalListStateKey(user?.id, petId, dateRange);
  const initialScrollOffset = getJournalScrollOffset(listStateKey);
  const listRef = useRef<FlatList<TimelineItem>>(null);
  const renderedListStateKey = useRef(listStateKey);
  const postsQuery = usePosts(petId, dateRange);
  const authorsQuery = usePetPostAuthors(petId);
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [photoViewer, setPhotoViewer] = useState<{
    initialIndex: number;
    media: PostWithMedia['post_media'];
  } | null>(null);
  const posts = useMemo(
    () => postsQuery.data?.pages.flatMap((page) => page.posts) ?? [],
    [postsQuery.data],
  );
  const timeline = useMemo(
    () => createTimelineItems(posts, i18n.language, t),
    [i18n.language, posts, t],
  );
  const previewPaths = useMemo(
    () =>
      posts.flatMap((post) =>
        post.post_media.map((media) => media.storage_path),
      ),
    [posts],
  );
  const mediaUrlsQuery = usePostMediaUrls(previewPaths);
  const videoThumbnailPaths = useMemo(
    () =>
      posts.flatMap((post) =>
        post.post_videos ? [post.post_videos.thumbnail_path] : [],
      ),
    [posts],
  );
  const videoThumbnailUrlsQuery = usePostVideoThumbnailUrls(
    videoThumbnailPaths,
    petId,
  );
  const lastMediaRecoveryAt = useRef(0);
  const recoverMediaUrls = useCallback(() => {
    if (Date.now() - lastMediaRecoveryAt.current < 60_000) return;
    lastMediaRecoveryAt.current = Date.now();
    void mediaUrlsQuery.refetch();
    void videoThumbnailUrlsQuery.refetch();
  }, [mediaUrlsQuery, videoThumbnailUrlsQuery]);
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
  const refreshJournal = useCallback(
    () =>
      runManualRefresh(setIsManualRefreshing, () =>
        Promise.all([
          postsQuery.refetch(),
          authorsQuery.refetch(),
          mediaUrlsQuery.refetch(),
          videoThumbnailUrlsQuery.refetch(),
        ]),
      ),
    [authorsQuery, mediaUrlsQuery, postsQuery, videoThumbnailUrlsQuery],
  );
  const dateRangeLabel = dateRange
    ? formatCompactJournalDateRange(dateRange, i18n.language)
    : t('journal.filter.all');
  const accessibleDateRangeLabel = dateRange
    ? formatAccessibleJournalDateRange(dateRange, i18n.language)
    : t('journal.filter.all');

  useEffect(() => {
    if (renderedListStateKey.current === listStateKey) return;
    renderedListStateKey.current = listStateKey;
    listRef.current?.scrollToOffset({
      animated: false,
      offset: initialScrollOffset,
    });
  }, [initialScrollOffset, listStateKey]);

  if (petsState.isPending) {
    return <LoadingView label={t('pets.loading.list')} />;
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <FlatList
        ListEmptyComponent={
          petsState.isError || postsQuery.isError || authorsQuery.isError ? (
            <View style={styles.messageState}>
              <AppText tone="error">{t('posts.errors.load')}</AppText>
              <AppButton
                label={t('common.retry')}
                onPress={() => {
                  void petsState.refetch();
                  void postsQuery.refetch();
                  void authorsQuery.refetch();
                }}
                variant="secondary"
              />
            </View>
          ) : isJournalInitialLoading(
              Boolean(petsState.currentPet),
              postsQuery.data !== undefined,
              postsQuery.isPending || authorsQuery.isPending,
            ) ? (
            <ActivityIndicator
              color={lightColors.primary}
              style={styles.emptyLoader}
            />
          ) : petsState.currentPet && dateRange ? (
            <View style={styles.emptyState}>
              <EmptyState
                actionLabel={t('journal.filter.clear')}
                body={t('journal.filter.emptyBody', {
                  range: accessibleDateRangeLabel,
                })}
                icon="calendar-outline"
                onActionPress={() => setDateRange(journalContextKey, undefined)}
                title={t('journal.filter.emptyTitle')}
              />
            </View>
          ) : petsState.currentPet ? (
            <View style={styles.emptyState}>
              <EmptyState
                actionLabel={t('posts.empty.action')}
                body={t('posts.empty.body', {
                  name: petsState.currentPet.name,
                })}
                icon="book-outline"
                onActionPress={() => router.push('/posts/new')}
                title={t('posts.empty.title')}
              />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <EmptyState
                body={t('posts.empty.noPetBody')}
                icon="paw-outline"
                title={t('posts.empty.noPetTitle')}
              />
            </View>
          )
        }
        ListFooterComponent={
          postsQuery.isFetchingNextPage ? (
            <ActivityIndicator
              color={lightColors.primary}
              style={styles.footerLoader}
            />
          ) : null
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <AppText
                accessibilityRole="header"
                style={styles.title}
                variant="largeTitle"
              >
                {t('journal.title')}
              </AppText>

              {petsState.currentPet ? (
                <Pressable
                  accessibilityLabel={t('journal.filter.accessibility', {
                    range: accessibleDateRangeLabel,
                  })}
                  accessibilityRole="button"
                  onPress={() => setIsDateFilterOpen(true)}
                  style={({ pressed }) => [
                    styles.filterAction,
                    pressed && styles.pressed,
                  ]}
                >
                  <AppText
                    ellipsizeMode="tail"
                    numberOfLines={1}
                    style={styles.filterActionLabel}
                    tone={dateRange ? 'brand' : 'secondary'}
                    variant="subheadline"
                  >
                    {dateRangeLabel}
                  </AppText>
                  <Ionicons
                    color={lightColors.textSecondary}
                    name="chevron-down"
                    size={16}
                  />
                </Pressable>
              ) : null}
            </View>
          </View>
        }
        contentContainerStyle={styles.listContent}
        contentOffset={{ x: 0, y: initialScrollOffset }}
        data={authorsQuery.isError ? [] : timeline}
        extraData={mediaUrlsQuery.data}
        initialNumToRender={8}
        keyboardDismissMode="on-drag"
        keyExtractor={(item) => item.id}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        maxToRenderPerBatch={8}
        onEndReached={() => {
          if (postsQuery.hasNextPage && !postsQuery.isFetchingNextPage) {
            void postsQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.35}
        onScroll={(event) =>
          setJournalScrollOffset(
            listStateKey,
            event.nativeEvent.contentOffset.y,
          )
        }
        refreshControl={
          <RefreshControl
            onRefresh={() => void refreshJournal()}
            refreshing={isManualRefreshing}
            tintColor={lightColors.primary}
          />
        }
        ref={listRef}
        renderItem={({ item }) => {
          if (item.kind === 'year') {
            return (
              <AppText style={styles.year} variant="title1">
                {item.label}
              </AppText>
            );
          }
          if (item.kind === 'month') {
            return (
              <AppText style={styles.month} tone="brand" variant="headline">
                {item.label}
              </AppText>
            );
          }
          if (item.kind === 'day') {
            return (
              <View style={styles.dayRow}>
                <View style={styles.dayDot} />
                <AppText tone="secondary" variant="subheadline">
                  {item.label}
                </AppText>
              </View>
            );
          }

          return (
            <TimelinePost
              authorName={authorNames[item.post.author_id]}
              mediaUrls={mediaUrlsQuery.data ?? {}}
              videoThumbnailUrls={videoThumbnailUrlsQuery.data ?? {}}
              onMediaError={recoverMediaUrls}
              onOpenPhoto={(initialIndex) =>
                setPhotoViewer({ initialIndex, media: item.post.post_media })
              }
              onOpenVideo={() =>
                router.push(`/posts/${item.post.id}/video` as Href)
              }
              onPress={() => router.push(`/posts/${item.post.id}` as Href)}
              post={item.post}
            />
          );
        }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={100}
        style={styles.list}
        updateCellsBatchingPeriod={50}
        windowSize={7}
      />

      {isDateFilterOpen ? (
        <JournalDateFilterModal
          onApply={(range) => setDateRange(journalContextKey, range)}
          onClose={() => setIsDateFilterOpen(false)}
          range={dateRange}
          visible
        />
      ) : null}
      {photoViewer ? (
        <PostPhotoViewer
          hasLoadError={mediaUrlsQuery.isError}
          initialIndex={photoViewer.initialIndex}
          isLoading={mediaUrlsQuery.isPending}
          media={photoViewer.media}
          mediaUrls={mediaUrlsQuery.data ?? {}}
          onClose={() => setPhotoViewer(null)}
          onImageError={recoverMediaUrls}
          visible
        />
      ) : null}
    </SafeAreaView>
  );
}

function createTimelineItems(
  posts: PostWithMedia[],
  locale: string,
  t: TFunction,
) {
  const items: TimelineItem[] = [];
  let previousYear = '';
  let previousMonth = '';
  let previousDate = '';

  for (const post of posts) {
    const date = parseDateOnly(post.event_date);
    if (!date) continue;
    const yearKey = String(date.getFullYear());
    const monthKey = `${yearKey}-${date.getMonth() + 1}`;

    if (yearKey !== previousYear) {
      items.push({
        id: `year-${yearKey}`,
        kind: 'year',
        label: new Intl.DateTimeFormat(locale, { year: 'numeric' }).format(
          date,
        ),
      });
      previousYear = yearKey;
      previousMonth = '';
      previousDate = '';
    }

    if (monthKey !== previousMonth) {
      items.push({
        id: `month-${monthKey}`,
        kind: 'month',
        label: new Intl.DateTimeFormat(locale, { month: 'long' }).format(date),
      });
      previousMonth = monthKey;
      previousDate = '';
    }

    if (post.event_date !== previousDate) {
      items.push({
        id: `day-${post.event_date}`,
        kind: 'day',
        label: getDayLabel(post.event_date, date, locale, t),
      });
      previousDate = post.event_date;
    }

    items.push({ id: `post-${post.id}`, kind: 'post', post });
  }

  return items;
}

function getDayLabel(
  dateOnly: string,
  date: Date,
  locale: string,
  t: TFunction,
) {
  const relativeKind = getRelativeDateKind(dateOnly);
  if (relativeKind === 'today') return t('journal.today');
  if (relativeKind === 'yesterday') return t('journal.yesterday');
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    weekday: 'long',
  }).format(date);
}

function TimelinePost({
  authorName,
  mediaUrls,
  videoThumbnailUrls,
  onMediaError,
  onOpenPhoto,
  onOpenVideo,
  onPress,
  post,
}: {
  authorName: string | undefined;
  mediaUrls: Record<string, string>;
  videoThumbnailUrls: Record<string, string>;
  onMediaError: () => void;
  onOpenPhoto: (index: number) => void;
  onOpenVideo: () => void;
  onPress: () => void;
  post: PostWithMedia;
}) {
  const { i18n, t } = useTranslation();
  const [isContentTruncated, setIsContentTruncated] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
    >
      <View style={styles.timelineLine} />
      <View style={styles.metaRow}>
        <AppText style={styles.author} tone="secondary" variant="footnote">
          {authorName ?? t('family.members.formerMember')}
          {' · '}
          {new Intl.DateTimeFormat(i18n.language, {
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(post.created_at))}
        </AppText>
        {post.tag ? (
          <View style={styles.tag}>
            <AppText tone="brand" variant="caption">
              {t(`posts.tags.${post.tag}`)}
            </AppText>
          </View>
        ) : null}
      </View>
      <PostMediaPreview
        media={post.post_media}
        mediaUrls={mediaUrls}
        onImageError={onMediaError}
        onPhotoPress={onOpenPhoto}
      />
      {post.post_videos ? (
        <PostVideoThumbnail
          onImageError={onMediaError}
          onPress={onOpenVideo}
          thumbnailUrl={
            videoThumbnailUrls[post.post_videos.thumbnail_path] ?? null
          }
          video={post.post_videos}
        />
      ) : null}
      {post.content ? (
        <View style={styles.contentCopy}>
          <AppText numberOfLines={3}>{post.content}</AppText>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onTextLayout={(event) =>
              setIsContentTruncated(event.nativeEvent.lines.length > 3)
            }
            style={styles.contentMeasure}
          >
            {post.content}
          </AppText>
          {isContentTruncated ? (
            <AppText tone="brand" variant="footnote">
              {t('journal.readMore')}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {post.location_name ? (
        <View style={styles.locationRow}>
          <Ionicons
            color={lightColors.textTertiary}
            name="location-outline"
            size={16}
          />
          <AppText tone="tertiary" variant="footnote">
            {post.location_name}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: lightColors.background },
  list: { flex: 1, width: '100%' },
  listContent: {
    ...contentStyles.readable,
    flexGrow: 1,
    paddingBottom: spacing.huge,
    paddingHorizontal: layout.screenPadding,
  },
  header: {
    paddingTop: spacing.md,
  },
  titleRow: {
    minHeight: 52,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  title: { flex: 1 },
  filterAction: {
    minHeight: 44,
    maxWidth: 160,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'flex-end',
    paddingLeft: spacing.md,
  },
  filterActionLabel: { minWidth: 0, flexShrink: 1 },
  year: { marginBottom: spacing.md, marginTop: spacing.xl },
  month: { marginBottom: spacing.lg, marginTop: spacing.xs },
  dayRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  dayDot: {
    width: 8,
    height: 8,
    backgroundColor: lightColors.secondary,
    borderRadius: radius.full,
  },
  entry: {
    gap: spacing.md,
    marginBottom: spacing.xxl,
    paddingLeft: spacing.xl,
    position: 'relative',
  },
  timelineLine: {
    position: 'absolute',
    bottom: -spacing.xxl,
    left: 3,
    top: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: lightColors.border,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  author: { flex: 1 },
  tag: {
    backgroundColor: lightColors.primarySoft,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  contentCopy: { gap: spacing.xs },
  contentMeasure: {
    left: 0,
    opacity: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: -1,
  },
  locationRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  emptyState: { minHeight: 420, flex: 1 },
  emptyLoader: { paddingTop: spacing.huge },
  messageState: {
    alignItems: 'flex-start',
    gap: spacing.lg,
    paddingTop: spacing.huge,
  },
  footerLoader: { padding: spacing.xl },
  pressed: { opacity: 0.7 },
});
