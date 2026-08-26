import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
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

import { useDeletePost, usePost, usePostMediaUrls } from './post-queries';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const postQuery = usePost(id);
  const deletePost = useDeletePost();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
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
  const leaveDetail = () => router.replace('/journal');

  const performDelete = async () => {
    setDeleteError(null);

    try {
      await deletePost.mutateAsync(id);
      router.replace('/journal');
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

  const viewerMedia =
    viewerIndex === null ? null : (post.post_media[viewerIndex] ?? null);
  const authorName =
    authorsQuery.data?.find((author) => author.userId === post.author_id)
      ?.displayName ?? t('family.members.formerMember');
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

    Alert.alert(t('posts.actions.title'), undefined, [
      ...(isAuthor
        ? [
            {
              onPress: () => router.push(`/posts/${post.id}/edit` as Href),
              text: t('common.edit'),
            },
          ]
        : []),
      ...(canDelete
        ? [
            {
              onPress: confirmDelete,
              style: 'destructive' as const,
              text: t('posts.delete.action'),
            },
          ]
        : []),
      { style: 'cancel' as const, text: t('common.cancel') },
    ]);
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

      <View style={styles.metaRow}>
        <AppText tone="secondary" variant="subheadline">
          {t('posts.authorWithDate', {
            author: authorName,
            date: formatDateOnly(post.event_date, i18n.language),
            time: new Intl.DateTimeFormat(i18n.language, {
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(post.created_at)),
          })}
        </AppText>
        {post.tag ? (
          <View style={styles.tag}>
            <AppText tone="brand">{t(`posts.tags.${post.tag}`)}</AppText>
          </View>
        ) : null}
      </View>

      {post.post_media.length > 0 ? (
        <View style={styles.photoGrid}>
          {post.post_media.map((media, index) => (
            <Pressable
              accessibilityLabel={t('posts.photos.openFullscreen', {
                position: index + 1,
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

      {post.content ? <AppText variant="body">{post.content}</AppText> : null}
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

      <Modal
        animationType="fade"
        onRequestClose={() => setViewerIndex(null)}
        transparent={false}
        visible={viewerIndex !== null}
      >
        <SafeAreaView edges={['top', 'bottom']} style={styles.viewer}>
          {viewerIndex !== null ? <StatusBar style="light" /> : null}
          <IconButton
            accessibilityLabel={t('common.close')}
            color={lightColors.onPrimary}
            icon="close"
            onPress={() => setViewerIndex(null)}
            style={styles.viewerClose}
          />
          {viewerMedia ? (
            <Image
              accessibilityLabel={t('posts.photos.fullscreen', {
                position: (viewerIndex ?? 0) + 1,
              })}
              cachePolicy="memory-disk"
              contentFit="contain"
              onError={recoverMediaUrls}
              source={urlsQuery.data?.[viewerMedia.storage_path] ?? null}
              style={styles.viewerImage}
            />
          ) : null}
          <View style={styles.viewerControls}>
            <IconButton
              accessibilityLabel={t('posts.photos.previous')}
              color={lightColors.onPrimary}
              icon="chevron-back"
              onPress={() =>
                setViewerIndex((current) =>
                  current === null ? null : Math.max(0, current - 1),
                )
              }
              style={styles.viewerButton}
            />
            <AppText tone="onPrimary">
              {t('posts.photos.viewerPosition', {
                position: (viewerIndex ?? 0) + 1,
                total: post.post_media.length,
              })}
            </AppText>
            <IconButton
              accessibilityLabel={t('posts.photos.next')}
              color={lightColors.onPrimary}
              icon="chevron-forward"
              onPress={() =>
                setViewerIndex((current) =>
                  current === null
                    ? null
                    : Math.min(post.post_media.length - 1, current + 1),
                )
              }
              style={styles.viewerButton}
            />
          </View>
        </SafeAreaView>
      </Modal>
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
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tag: {
    backgroundColor: lightColors.primarySoft,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
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
  locationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  viewer: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
  },
  viewerImage: {
    width: '100%',
    height: '78%',
  },
  viewerClose: {
    position: 'absolute',
    right: spacing.xl,
    top: spacing.huge,
    zIndex: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  viewerControls: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.huge,
    left: spacing.xl,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  viewerButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
});
