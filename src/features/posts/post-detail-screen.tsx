import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { Avatar } from '@/components/avatar';
import { IconButton } from '@/components/icon-button';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import {
  usePetMembers,
  usePetPostAuthors,
} from '@/features/family/family-queries';
import { formatDateOnly } from '@/features/pets/pet-dates';
import { lightColors, radius, spacing } from '@/theme';

import { PostActionsModal } from './components/post-actions-modal';
import { PostPhotoViewer } from './components/post-photo-viewer';
import { useDeletePost, usePost, usePostMediaUrls } from './post-queries';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const postQuery = usePost(id);
  const deletePost = useDeletePost();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const paths =
    postQuery.data?.post_media.map((item) => item.storage_path) ?? [];
  const urlsQuery = usePostMediaUrls(paths);
  const lastMediaRecoveryAt = useRef(0);
  const recoverMediaUrls = useCallback(() => {
    if (Date.now() - lastMediaRecoveryAt.current < 60_000) return;
    lastMediaRecoveryAt.current = Date.now();
    void urlsQuery.refetch();
  }, [urlsQuery]);
  const post = postQuery.data;
  const membersQuery = usePetMembers(post?.pet_id ?? null);
  const authorsQuery = usePetPostAuthors(post?.pet_id ?? null);
  const leaveDetail = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/journal');
    }
  };

  const performDelete = async () => {
    setDeleteError(null);

    try {
      await deletePost.mutateAsync(id);
      leaveDetail();
    } catch {
      setDeleteError(t('posts.errors.delete'));
    }
  };

  const confirmDelete = () => {
    if (Platform.OS === 'web') {
      if (globalThis.confirm(t('posts.delete.body'))) {
        void performDelete();
      }
      return;
    }

    Alert.alert(t('posts.delete.title'), t('posts.delete.body'), [
      { style: 'cancel', text: t('common.cancel') },
      {
        onPress: () => void performDelete(),
        style: 'destructive',
        text: t('posts.delete.action'),
      },
    ]);
  };

  if (postQuery.isPending) {
    return <LoadingView label={t('posts.loading.detail')} />;
  }

  if (!post) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('posts.errors.notFound')}</AppText>
        <AppButton
          label={t('common.back')}
          onPress={leaveDetail}
          variant="secondary"
        />
      </Screen>
    );
  }

  if (membersQuery.isError || authorsQuery.isError) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('posts.errors.notFound')}</AppText>
        <AppButton
          label={t('common.back')}
          onPress={leaveDetail}
          variant="secondary"
        />
      </Screen>
    );
  }

  const authorName =
    authorsQuery.data?.find((author) => author.userId === post.author_id)
      ?.displayName ?? t('family.members.formerMember');
  const authorMember = membersQuery.data?.find(
    (member) => member.userId === post.author_id,
  );
  const authorDate = formatDateOnly(post.event_date, i18n.language);
  const authorTime = new Intl.DateTimeFormat(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(post.created_at));
  const authorAvatarLabel = t('posts.actions.authorAvatar', {
    name: authorName,
  });
  const isAuthor = post.author_id === user?.id;
  const isOwner = membersQuery.data?.some(
    (member) => member.userId === user?.id && member.role === 'owner',
  );
  const canDelete = Boolean(isAuthor || isOwner);
  const showActions = () => {
    if (Platform.OS === 'web') {
      if (isAuthor) {
        router.push(`/posts/${post.id}/edit` as Href);
      } else if (canDelete) {
        confirmDelete();
      }
      return;
    }
    setActionsVisible(true);
  };

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <View style={styles.topBar}>
        <IconButton
          accessibilityLabel={t('common.back')}
          icon="chevron-back"
          onPress={leaveDetail}
        />
        {canDelete ? (
          <IconButton
            accessibilityLabel={t('posts.actions.title')}
            icon="ellipsis-horizontal"
            onPress={showActions}
          />
        ) : null}
      </View>

      <View style={styles.authorHeader}>
        <View
          accessibilityLabel={authorAvatarLabel}
          accessibilityRole="image"
          accessible
        >
          <Avatar
            accessibilityLabel={authorAvatarLabel}
            name={authorName}
            size={40}
            source={
              authorMember?.avatarUrl
                ? { uri: authorMember.avatarUrl }
                : undefined
            }
          />
        </View>
        <View style={styles.authorCopy}>
          <AppText
            ellipsizeMode="tail"
            numberOfLines={1}
            style={styles.authorName}
            variant="headline"
          >
            {authorName}
          </AppText>
          <AppText tone="secondary" variant="footnote">
            {authorDate} · {authorTime}
          </AppText>
        </View>
        {post.tag ? (
          <View style={styles.tag}>
            <AppText tone="brand" variant="footnote">
              {t(`posts.tags.${post.tag}`)}
            </AppText>
          </View>
        ) : null}
      </View>

      {post.post_media.length === 1 ? (
        <Pressable
          accessibilityLabel={t('posts.photos.openFullscreenPosition', {
            position: 1,
            total: 1,
          })}
          accessibilityRole="button"
          onPress={() => setViewerIndex(0)}
          style={({ pressed }) => [
            styles.singlePhotoWrap,
            {
              aspectRatio:
                post.post_media[0]!.width /
                Math.max(post.post_media[0]!.height, 1),
            },
            pressed && styles.photoPressed,
          ]}
        >
          <Image
            cachePolicy="memory-disk"
            contentFit="contain"
            onError={recoverMediaUrls}
            recyclingKey={post.post_media[0]!.id}
            source={urlsQuery.data?.[post.post_media[0]!.storage_path] ?? null}
            style={styles.singlePhoto}
            transition={180}
          />
        </Pressable>
      ) : post.post_media.length > 1 ? (
        <View style={styles.photoGrid}>
          {post.post_media.map((media, index) => (
            <Pressable
              accessibilityLabel={t('posts.photos.openFullscreenPosition', {
                position: index + 1,
                total: post.post_media.length,
              })}
              accessibilityRole="button"
              key={media.id}
              onPress={() => setViewerIndex(index)}
              style={styles.photoWrap}
            >
              <Image
                cachePolicy="memory-disk"
                contentFit="cover"
                onError={recoverMediaUrls}
                recyclingKey={media.id}
                source={urlsQuery.data?.[media.storage_path] ?? null}
                style={styles.photo}
                transition={180}
              />
            </Pressable>
          ))}
        </View>
      ) : null}

      {post.content ? (
        <AppText style={styles.body} variant="body">
          {post.content}
        </AppText>
      ) : null}
      {post.location_name ? (
        <View style={styles.locationRow}>
          <Ionicons
            color={lightColors.textSecondary}
            name="location-outline"
            size={18}
          />
          <AppText tone="secondary">{post.location_name}</AppText>
        </View>
      ) : null}

      {deleteError ? <AppText tone="error">{deleteError}</AppText> : null}

      <PostActionsModal
        canDelete={canDelete}
        canEdit={isAuthor}
        onCancel={() => setActionsVisible(false)}
        onDelete={() => {
          setActionsVisible(false);
          confirmDelete();
        }}
        onEdit={() => {
          setActionsVisible(false);
          router.push(`/posts/${post.id}/edit` as Href);
        }}
        visible={actionsVisible}
      />

      {viewerIndex !== null ? (
        <PostPhotoViewer
          hasLoadError={urlsQuery.isError}
          initialIndex={viewerIndex}
          isLoading={urlsQuery.isPending}
          media={post.post_media}
          mediaUrls={urlsQuery.data ?? {}}
          onClose={() => setViewerIndex(null)}
          onImageError={recoverMediaUrls}
          visible
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    paddingBottom: spacing.huge,
    paddingTop: spacing.md,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  authorHeader: {
    width: '100%',
    maxWidth: 640,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  authorCopy: {
    minWidth: 0,
    flex: 1,
    gap: spacing.xs,
  },
  authorName: {
    minWidth: 0,
    flexShrink: 1,
  },
  tag: {
    backgroundColor: lightColors.primarySoft,
    borderRadius: radius.full,
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  singlePhotoWrap: {
    width: '100%',
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  singlePhoto: {
    width: '100%',
    height: '100%',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  photoWrap: {
    width: '48.5%',
  },
  photo: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.md,
  },
  photoPressed: { opacity: 0.76 },
  body: { width: '100%', maxWidth: 640 },
  locationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
