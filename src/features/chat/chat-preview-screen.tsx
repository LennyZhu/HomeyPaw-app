import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlatList as FlatListType } from 'react-native';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { IconButton } from '@/components/icon-button';
import { LoadingView } from '@/components/loading-view';
import i18n, { type SupportedLanguage } from '@/i18n';
import { lightColors, layout, radius, shadows, spacing } from '@/theme';

import { ChatComposer } from './components/chat-composer';
import { ChatMessageList } from './components/chat-message-list';
import type {
  ChatPreviewStory,
  MockChatMessage,
  MockChatPet,
} from './chat-preview-types';
import {
  createEarlierMessages,
  createMockMessages,
  MOCK_CHAT_PETS,
  SINGLE_MEMBER_MOCK_PET,
} from './mock-chat-data';

const CHAT_STORIES: ChatPreviewStory[] = [
  'active',
  'empty',
  'noPet',
  'singleMember',
  'longMessage',
  'multiImage',
  'systemCare',
  'keyboard',
  'maxDynamicType',
  'performance',
  'loading',
  'error',
];
const DEFAULT_MOCK_PET = MOCK_CHAT_PETS[0]!;
const PREVIEW_CHROME_MAX_FONT_SCALE = 1.6;

type SheetProps = {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  visible: boolean;
};

function BottomSheet({ children, onClose, title, visible }: SheetProps) {
  const { t } = useTranslation();

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      transparent={Platform.OS !== 'ios'}
      visible={visible}
    >
      <SafeAreaView style={styles.sheetSafeArea}>
        <View style={styles.sheetHeader}>
          <AppText
            accessibilityRole="header"
            style={styles.sheetTitle}
            variant="title2"
          >
            {title}
          </AppText>
          <IconButton
            accessibilityLabel={t('common.close')}
            icon="close"
            onPress={onClose}
          />
        </View>
        {children}
      </SafeAreaView>
    </Modal>
  );
}

function PreviewHeader({
  onBack,
  onMembersPress,
  onPetPress,
  pet,
}: {
  onBack: () => void;
  onMembersPress: () => void;
  onPetPress: () => void;
  pet: MockChatPet;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.header}>
      <IconButton
        accessibilityLabel={t('common.back')}
        icon="chevron-back"
        onPress={onBack}
        style={styles.headerIconButton}
      />
      <Pressable
        accessibilityHint={t('chat.preview.header.switchHint')}
        accessibilityLabel={t('chat.preview.header.switchPet', {
          name: pet.name,
        })}
        accessibilityRole="button"
        onPress={onPetPress}
        style={({ pressed }) => [styles.headerPet, pressed && styles.pressed]}
      >
        <Avatar
          accessibilityLabel={t('pets.avatar.accessibility', {
            name: pet.name,
          })}
          name={pet.name}
          size={42}
        />
        <View style={styles.headerCopy}>
          <AppText
            maxFontSizeMultiplier={PREVIEW_CHROME_MAX_FONT_SCALE}
            numberOfLines={2}
            style={styles.headerTitle}
            variant="headline"
          >
            {t('chat.preview.header.title', { name: pet.name })}
          </AppText>
          <View style={styles.headerMetaRow}>
            <AppText
              maxFontSizeMultiplier={PREVIEW_CHROME_MAX_FONT_SCALE}
              tone="secondary"
              variant="caption"
            >
              {t('chat.preview.header.memberCount', {
                count: pet.memberCount,
              })}
            </AppText>
            <Ionicons
              color={lightColors.textTertiary}
              name="chevron-down"
              size={13}
            />
          </View>
        </View>
      </Pressable>
      <IconButton
        accessibilityLabel={t('chat.preview.header.more')}
        icon="ellipsis-horizontal"
        onPress={onMembersPress}
        style={styles.headerIconButton}
      />
    </View>
  );
}

function PreviewControlBar({
  messageCount,
  onPress,
  story,
}: {
  messageCount: number;
  onPress: () => void;
  story: ChatPreviewStory;
}) {
  const { t } = useTranslation();

  return (
    <Pressable
      accessibilityHint={t('chat.preview.controls.hint')}
      accessibilityLabel={t('chat.preview.controls.accessibility', {
        story: t(`chat.preview.stories.${story}`),
      })}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.previewBar, pressed && styles.pressed]}
    >
      <View style={styles.previewBadge}>
        <View style={styles.previewDot} />
        <AppText
          maxFontSizeMultiplier={PREVIEW_CHROME_MAX_FONT_SCALE}
          style={styles.previewLabel}
          tone="brand"
          variant="caption"
        >
          {t('chat.preview.label')}
        </AppText>
      </View>
      <AppText
        maxFontSizeMultiplier={PREVIEW_CHROME_MAX_FONT_SCALE}
        numberOfLines={1}
        style={styles.previewStory}
        tone="secondary"
        variant="caption"
      >
        {t(`chat.preview.stories.${story}`)}
      </AppText>
      {messageCount > 0 ? (
        <AppText
          maxFontSizeMultiplier={PREVIEW_CHROME_MAX_FONT_SCALE}
          numberOfLines={1}
          tone="tertiary"
          variant="caption"
        >
          {t('chat.preview.controls.messageCount', { count: messageCount })}
        </AppText>
      ) : null}
      <Ionicons
        color={lightColors.textTertiary}
        name="options-outline"
        size={17}
      />
    </Pressable>
  );
}

function ScenarioSheet({
  onClose,
  onLanguageChange,
  onStoryChange,
  story,
  visible,
}: {
  onClose: () => void;
  onLanguageChange: (language: SupportedLanguage) => void;
  onStoryChange: (story: ChatPreviewStory) => void;
  story: ChatPreviewStory;
  visible: boolean;
}) {
  const { t } = useTranslation();

  return (
    <BottomSheet
      onClose={onClose}
      title={t('chat.preview.controls.title')}
      visible={visible}
    >
      <ScrollView
        contentContainerStyle={styles.sheetScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <AppText tone="secondary" variant="subheadline">
          {t('chat.preview.controls.body')}
        </AppText>
        <View style={styles.languageRow}>
          {(['zh-HK', 'en'] as SupportedLanguage[]).map((language) => {
            const selected = i18n.language === language;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={language}
                onPress={() => onLanguageChange(language)}
                style={({ pressed }) => [
                  styles.languageButton,
                  selected && styles.languageButtonSelected,
                  pressed && styles.pressed,
                ]}
              >
                <AppText
                  tone={selected ? 'brand' : 'secondary'}
                  variant="subheadline"
                >
                  {language === 'zh-HK'
                    ? t('chat.preview.controls.zhHK')
                    : t('chat.preview.controls.english')}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.storyList}>
          {CHAT_STORIES.map((candidate) => {
            const selected = candidate === story;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={candidate}
                onPress={() => onStoryChange(candidate)}
                style={({ pressed }) => [
                  styles.storyRow,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.storyCopy}>
                  <AppText variant="headline">
                    {t(`chat.preview.stories.${candidate}`)}
                  </AppText>
                  <AppText tone="secondary" variant="footnote">
                    {t(`chat.preview.storyNotes.${candidate}`)}
                  </AppText>
                </View>
                <Ionicons
                  color={selected ? lightColors.primary : lightColors.border}
                  name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={23}
                />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

function PetSwitcherSheet({
  currentPetId,
  onClose,
  onSelect,
  visible,
}: {
  currentPetId: string;
  onClose: () => void;
  onSelect: (petId: string) => void;
  visible: boolean;
}) {
  const { t } = useTranslation();

  return (
    <BottomSheet
      onClose={onClose}
      title={t('chat.preview.petSwitcher.title')}
      visible={visible}
    >
      <View style={styles.sheetBody}>
        <AppText tone="secondary" variant="subheadline">
          {t('chat.preview.petSwitcher.body')}
        </AppText>
        <View style={styles.petList}>
          {MOCK_CHAT_PETS.map((pet) => {
            const selected = pet.id === currentPetId;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={pet.id}
                onPress={() => onSelect(pet.id)}
                style={({ pressed }) => [
                  styles.petRow,
                  pressed && styles.pressed,
                ]}
              >
                <Avatar
                  accessibilityLabel={t('pets.avatar.accessibility', {
                    name: pet.name,
                  })}
                  name={pet.name}
                  size={50}
                />
                <View style={styles.petRowCopy}>
                  <AppText variant="headline">{pet.name}</AppText>
                  <AppText tone="secondary" variant="footnote">
                    {t('chat.preview.header.memberCount', {
                      count: pet.memberCount,
                    })}
                  </AppText>
                </View>
                {selected ? (
                  <Ionicons
                    color={lightColors.success}
                    name="checkmark-circle"
                    size={24}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </BottomSheet>
  );
}

function MembersSheet({
  onClose,
  pet,
  visible,
}: {
  onClose: () => void;
  pet: MockChatPet;
  visible: boolean;
}) {
  const { t } = useTranslation();

  return (
    <BottomSheet
      onClose={onClose}
      title={t('chat.preview.members.title')}
      visible={visible}
    >
      <View style={styles.sheetBody}>
        {pet.memberNameKeys.map((memberNameKey) => {
          const name = t(memberNameKey);
          return (
            <View key={memberNameKey} style={styles.memberRow}>
              <Avatar
                accessibilityLabel={t(
                  'chat.preview.accessibility.memberAvatar',
                  { name },
                )}
                name={name}
                size={42}
              />
              <AppText style={styles.memberName} variant="body">
                {name}
              </AppText>
            </View>
          );
        })}
        <View style={styles.settingsNote}>
          <Ionicons
            color={lightColors.secondary}
            name="settings-outline"
            size={20}
          />
          <AppText
            style={styles.settingsNoteCopy}
            tone="secondary"
            variant="subheadline"
          >
            {t('chat.preview.members.settingsComing')}
          </AppText>
        </View>
      </View>
    </BottomSheet>
  );
}

function AttachmentSheet({
  onClose,
  visible,
}: {
  onClose: () => void;
  visible: boolean;
}) {
  const { t } = useTranslation();

  return (
    <BottomSheet
      onClose={onClose}
      title={t('chat.preview.attachment.title')}
      visible={visible}
    >
      <View style={styles.sheetBody}>
        <View style={styles.attachmentOptions}>
          <View style={styles.attachmentOption}>
            <Ionicons
              color={lightColors.secondary}
              name="images-outline"
              size={24}
            />
            <AppText variant="headline">
              {t('chat.preview.attachment.photo')}
            </AppText>
          </View>
          <View style={styles.attachmentOption}>
            <Ionicons
              color={lightColors.textTertiary}
              name="camera-outline"
              size={24}
            />
            <AppText tone="secondary" variant="headline">
              {t('chat.preview.attachment.camera')}
            </AppText>
          </View>
        </View>
        <View style={styles.settingsNote}>
          <Ionicons
            color={lightColors.secondary}
            name="information-circle-outline"
            size={21}
          />
          <AppText
            style={styles.settingsNoteCopy}
            tone="secondary"
            variant="subheadline"
          >
            {t('chat.preview.attachment.unavailable')}
          </AppText>
        </View>
      </View>
    </BottomSheet>
  );
}

function NoPetState({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={styles.safeArea}
    >
      <View style={styles.standaloneHeader}>
        <IconButton
          accessibilityLabel={t('common.back')}
          icon="chevron-back"
          onPress={onBack}
          style={styles.headerIconButton}
        />
        <AppText style={styles.standaloneTitle} variant="headline">
          {t('chat.preview.label')}
        </AppText>
        <View style={styles.headerButtonSpacer} />
      </View>
      <View style={styles.stateContent}>
        <EmptyState
          actionLabel={t('chat.preview.noPet.add')}
          body={t('chat.preview.noPet.body')}
          icon="chatbubble-ellipses-outline"
          onActionPress={() => router.push('/pets/new')}
          title={t('chat.preview.noPet.title')}
        />
        <AppButton
          label={t('chat.preview.noPet.join')}
          onPress={() => router.push('/join-family')}
          style={styles.secondaryStateButton}
          variant="secondary"
        />
      </View>
    </SafeAreaView>
  );
}

function SingleMemberState({ onInvite }: { onInvite: () => void }) {
  const { t } = useTranslation();

  return (
    <View style={styles.stateContent}>
      <EmptyState
        actionLabel={t('chat.preview.singleMember.action')}
        body={t('chat.preview.singleMember.body')}
        icon="people-outline"
        onActionPress={onInvite}
        title={t('chat.preview.singleMember.title')}
      />
    </View>
  );
}

function EmptyChatState() {
  const { t } = useTranslation();

  return (
    <View style={styles.emptyChat}>
      <View style={styles.emptyChatIcon}>
        <Ionicons
          color={lightColors.secondary}
          name="chatbubbles-outline"
          size={30}
        />
      </View>
      <AppText
        accessibilityRole="header"
        style={styles.centerText}
        variant="title2"
      >
        {t('chat.preview.empty.title')}
      </AppText>
      <AppText style={styles.centerText} tone="secondary">
        {t('chat.preview.empty.body')}
      </AppText>
      <View style={styles.promptCard}>
        <AppText
          style={styles.centerText}
          tone="secondary"
          variant="subheadline"
        >
          {t('chat.preview.empty.prompt')}
        </AppText>
      </View>
    </View>
  );
}

export default function ChatPreviewScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{
    language?: string;
    pet?: string;
    story?: string;
  }>();
  const listRef = useRef<FlatListType<MockChatMessage>>(null);
  const shouldScrollToEndRef = useRef(true);
  const [mockNow] = useState(() => new Date());
  const [initialLanguage] = useState(() => i18n.language);
  const [story, setStory] = useState<ChatPreviewStory>(() =>
    CHAT_STORIES.includes(params.story as ChatPreviewStory)
      ? (params.story as ChatPreviewStory)
      : 'active',
  );
  const [currentPetId, setCurrentPetId] = useState(() =>
    MOCK_CHAT_PETS.some((pet) => pet.id === params.pet)
      ? (params.pet as string)
      : DEFAULT_MOCK_PET.id,
  );
  const [sentMessagesByPet, setSentMessagesByPet] = useState<
    Record<string, MockChatMessage[]>
  >({});
  const [earlierLoadedByPet, setEarlierLoadedByPet] = useState<
    Record<string, boolean>
  >({});
  const [scenarioSheetOpen, setScenarioSheetOpen] = useState(false);
  const [petSheetOpen, setPetSheetOpen] = useState(false);
  const [membersSheetOpen, setMembersSheetOpen] = useState(false);
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);

  useEffect(() => {
    if (params.language === 'en' || params.language === 'zh-HK') {
      void i18n.changeLanguage(params.language);
    }

    return () => {
      void i18n.changeLanguage(initialLanguage);
    };
  }, [initialLanguage, params.language]);

  const pet =
    story === 'singleMember'
      ? SINGLE_MEMBER_MOCK_PET
      : (MOCK_CHAT_PETS.find((candidate) => candidate.id === currentPetId) ??
        DEFAULT_MOCK_PET);

  const baseMessages = useMemo(
    () => createMockMessages(pet.id, story, mockNow),
    [mockNow, pet.id, story],
  );
  const earlierMessages = earlierLoadedByPet[pet.id]
    ? createEarlierMessages(pet.id, mockNow)
    : [];
  const sentMessages = sentMessagesByPet[pet.id] ?? [];
  const messages = [...earlierMessages, ...baseMessages, ...sentMessages];
  const supportsComposer = !['singleMember', 'loading', 'error'].includes(
    story,
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const requestScrollToEnd = useCallback(() => {
    shouldScrollToEndRef.current = true;
  }, []);

  useEffect(() => {
    requestScrollToEnd();
  }, [pet.id, requestScrollToEnd, story]);

  const handleContentSizeChange = () => {
    if (!shouldScrollToEndRef.current) return;
    shouldScrollToEndRef.current = false;
    listRef.current?.scrollToEnd({ animated: false });
  };

  const handleSend = (body: string) => {
    const localMessage: MockChatMessage = {
      authorId: 'self',
      authorNameKey: null,
      body,
      createdAt: new Date().toISOString(),
      id: `local-${pet.id}-${Date.now()}`,
      isOwn: true,
      petId: pet.id,
      type: 'text',
    };

    shouldScrollToEndRef.current = true;
    setSentMessagesByPet((current) => ({
      ...current,
      [pet.id]: [...(current[pet.id] ?? []), localMessage],
    }));
  };

  const handleStoryChange = (nextStory: ChatPreviewStory) => {
    setStory(nextStory);
    setScenarioSheetOpen(false);
    if (nextStory !== 'singleMember' && nextStory !== 'noPet') {
      setCurrentPetId(DEFAULT_MOCK_PET.id);
    }
  };

  const handleLanguageChange = (language: SupportedLanguage) => {
    void i18n.changeLanguage(language);
  };

  if (story === 'noPet') {
    return (
      <>
        <NoPetState onBack={goBack} />
        <Pressable
          accessibilityLabel={t('chat.preview.controls.open')}
          accessibilityRole="button"
          onPress={() => setScenarioSheetOpen(true)}
          style={styles.floatingControls}
        >
          <Ionicons
            color={lightColors.onPrimary}
            name="options-outline"
            size={21}
          />
        </Pressable>
        <ScenarioSheet
          onClose={() => setScenarioSheetOpen(false)}
          onLanguageChange={handleLanguageChange}
          onStoryChange={handleStoryChange}
          story={story}
          visible={scenarioSheetOpen}
        />
      </>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <PreviewHeader
          onBack={goBack}
          onMembersPress={() => setMembersSheetOpen(true)}
          onPetPress={() => {
            if (story === 'singleMember') setMembersSheetOpen(true);
            else setPetSheetOpen(true);
          }}
          pet={pet}
        />
        <PreviewControlBar
          messageCount={messages.length}
          onPress={() => setScenarioSheetOpen(true)}
          story={story}
        />

        {story === 'loading' ? (
          <LoadingView label={t('chat.preview.loading')} />
        ) : story === 'error' ? (
          <View style={styles.errorState}>
            <View style={styles.errorIcon}>
              <Ionicons
                color={lightColors.error}
                name="cloud-offline-outline"
                size={30}
              />
            </View>
            <AppText
              accessibilityRole="header"
              style={styles.centerText}
              variant="title2"
            >
              {t('chat.preview.error.title')}
            </AppText>
            <AppText style={styles.centerText} tone="secondary">
              {t('chat.preview.error.body')}
            </AppText>
            <AppButton
              label={t('common.retry')}
              onPress={() => setStory('active')}
              style={styles.retryButton}
              variant="secondary"
            />
          </View>
        ) : story === 'singleMember' ? (
          <SingleMemberState onInvite={() => setMembersSheetOpen(true)} />
        ) : story === 'empty' && messages.length === 0 ? (
          <EmptyChatState />
        ) : (
          <ChatMessageList
            messages={messages}
            now={mockNow}
            onContentSizeChange={handleContentSizeChange}
            onLoadEarlier={() => {
              setEarlierLoadedByPet((current) => ({
                ...current,
                [pet.id]: true,
              }));
            }}
            ref={listRef}
            showLoadEarlier={
              story === 'active' && !Boolean(earlierLoadedByPet[pet.id])
            }
            showTypingIndicator={story === 'active'}
          />
        )}

        {supportsComposer ? (
          <ChatComposer
            autoFocus={story === 'keyboard'}
            key={`${pet.id}-${story === 'keyboard' ? 'keyboard' : 'default'}`}
            onAttachmentPress={() => setAttachmentSheetOpen(true)}
            onSend={handleSend}
            petId={pet.id}
          />
        ) : null}
      </KeyboardAvoidingView>

      <ScenarioSheet
        onClose={() => setScenarioSheetOpen(false)}
        onLanguageChange={handleLanguageChange}
        onStoryChange={handleStoryChange}
        story={story}
        visible={scenarioSheetOpen}
      />
      <PetSwitcherSheet
        currentPetId={pet.id}
        onClose={() => setPetSheetOpen(false)}
        onSelect={(petId) => {
          setCurrentPetId(petId);
          setPetSheetOpen(false);
        }}
        visible={petSheetOpen}
      />
      <MembersSheet
        onClose={() => setMembersSheetOpen(false)}
        pet={pet}
        visible={membersSheetOpen}
      />
      <AttachmentSheet
        onClose={() => setAttachmentSheetOpen(false)}
        visible={attachmentSheetOpen}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: lightColors.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    minHeight: 66,
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  headerIconButton: {
    backgroundColor: 'transparent',
  },
  headerPet: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minWidth: 0,
    paddingVertical: spacing.xs,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    flexShrink: 1,
  },
  headerMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  previewBar: {
    minHeight: 36,
    alignItems: 'center',
    backgroundColor: lightColors.primarySoft,
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  previewBadge: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  previewDot: {
    width: 6,
    height: 6,
    backgroundColor: lightColors.primary,
    borderRadius: radius.full,
  },
  previewLabel: {
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  previewStory: {
    flex: 1,
  },
  stateContent: {
    flex: 1,
    paddingBottom: spacing.xxxl,
    paddingHorizontal: layout.screenPadding,
  },
  secondaryStateButton: {
    alignSelf: 'center',
    marginTop: -spacing.lg,
  },
  emptyChat: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  emptyChatIcon: {
    width: 64,
    height: 64,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.full,
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  centerText: {
    maxWidth: 330,
    textAlign: 'center',
  },
  promptCard: {
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.xl,
    padding: spacing.lg,
  },
  errorState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  errorIcon: {
    width: 64,
    height: 64,
    alignItems: 'center',
    backgroundColor: '#F8E4E4',
    borderRadius: radius.full,
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  retryButton: {
    marginTop: spacing.xl,
  },
  standaloneHeader: {
    minHeight: 60,
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
  },
  standaloneTitle: {
    flex: 1,
    textAlign: 'center',
  },
  headerButtonSpacer: {
    width: layout.minimumTouchTarget,
  },
  floatingControls: {
    width: 48,
    height: 48,
    alignItems: 'center',
    backgroundColor: lightColors.primary,
    borderRadius: radius.full,
    bottom: spacing.xl,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.xl,
    ...shadows.floating,
  },
  sheetSafeArea: {
    flex: 1,
    backgroundColor: lightColors.background,
  },
  sheetHeader: {
    minHeight: 64,
    alignItems: 'center',
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
  },
  sheetTitle: {
    flex: 1,
  },
  sheetBody: {
    padding: spacing.xl,
  },
  sheetScrollContent: {
    padding: spacing.xl,
    paddingBottom: spacing.huge,
  },
  languageRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  languageButton: {
    minHeight: 44,
    alignItems: 'center',
    borderColor: lightColors.border,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  languageButtonSelected: {
    backgroundColor: lightColors.primarySoft,
    borderColor: lightColors.primary,
  },
  storyList: {
    marginTop: spacing.xl,
  },
  storyRow: {
    minHeight: 72,
    alignItems: 'center',
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  storyCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  petList: {
    marginTop: spacing.xl,
  },
  petRow: {
    minHeight: 72,
    alignItems: 'center',
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
  },
  petRowCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  memberRow: {
    minHeight: 62,
    alignItems: 'center',
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
  },
  memberName: {
    flex: 1,
  },
  settingsNote: {
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
    padding: spacing.lg,
  },
  settingsNoteCopy: {
    flex: 1,
  },
  attachmentOptions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  attachmentOption: {
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    gap: spacing.sm,
    padding: spacing.xl,
  },
  pressed: {
    opacity: 0.62,
  },
});
