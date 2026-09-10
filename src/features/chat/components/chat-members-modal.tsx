import { ModalScreen } from '@/components/modal-screen';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ImageSource } from 'expo-image';
import { Modal, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { Avatar } from '@/components/avatar';
import { IconButton } from '@/components/icon-button';
import { lightColors, radius, spacing } from '@/theme';

import type { ChatMemberSummary } from '../chat-queries';

type ChatMembersModalProps = {
  members: ChatMemberSummary[];
  onClose: () => void;
  petName: string;
  visible: boolean;
};

export function ChatMembersModal({
  members,
  onClose,
  petName,
  visible,
}: ChatMembersModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <ModalScreen contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View style={styles.headingCopy}>
            <AppText accessibilityRole="header" variant="title2">
              {t('chat.live.members.title')}
            </AppText>
            <AppText tone="secondary" variant="footnote">
              {t('chat.live.members.body', {
                count: members.length,
                name: petName,
              })}
            </AppText>
          </View>
          <IconButton
            accessibilityLabel={t('common.close')}
            icon="close"
            onPress={onClose}
          />
        </View>

        <View style={styles.list}>
          {members.map((member) => (
            <View key={member.userId} style={styles.memberRow}>
              <Avatar
                accessibilityLabel={t('chat.live.accessibility.memberAvatar', {
                  name: member.displayName,
                })}
                name={member.displayName}
                size={46}
                source={
                  member.avatarUrl
                    ? ({ uri: member.avatarUrl } satisfies ImageSource)
                    : undefined
                }
              />
              <View style={styles.memberCopy}>
                <AppText variant="headline">{member.displayName}</AppText>
                <AppText tone="secondary" variant="footnote">
                  {member.role === 'owner'
                    ? t('chat.live.members.owner')
                    : t('chat.live.members.member')}
                </AppText>
              </View>
              {member.role === 'owner' ? (
                <View style={styles.ownerBadge}>
                  <Ionicons
                    color={lightColors.secondary}
                    name="shield-checkmark-outline"
                    size={16}
                  />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </ModalScreen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: lightColors.background,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  headingCopy: { flex: 1, gap: spacing.xs },
  list: { paddingBottom: spacing.huge, paddingTop: spacing.xl },
  memberRow: {
    minHeight: 72,
    alignItems: 'center',
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
  },
  memberCopy: { flex: 1, gap: 2 },
  ownerBadge: {
    width: 34,
    height: 34,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
});
