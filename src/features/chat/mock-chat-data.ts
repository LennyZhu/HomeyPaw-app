import {
  addDateOnlyDays,
  getDateOnlyInZone,
  localDateTimeToInstant,
} from '@/features/reminders/care-task-recurrence';

import { CHAT_MOCK_TIME_ZONE } from './chat-date';
import type {
  ChatPreviewStory,
  MockChatMessage,
  MockChatPet,
} from './chat-preview-types';

export const MOCK_CHAT_PETS: MockChatPet[] = [
  {
    accent: '#C9604F',
    id: 'mock-pet-doudou',
    memberCount: 4,
    memberNameKeys: [
      'chat.preview.mock.members.lenny',
      'chat.preview.mock.members.mum',
      'chat.preview.mock.members.sister',
      'chat.preview.mock.members.dad',
    ],
    name: '豆豆',
  },
  {
    accent: '#6F8C78',
    id: 'mock-pet-mochi',
    memberCount: 3,
    memberNameKeys: [
      'chat.preview.mock.members.lenny',
      'chat.preview.mock.members.mum',
      'chat.preview.mock.members.sister',
    ],
    name: 'Mochi',
  },
];

export const SINGLE_MEMBER_MOCK_PET: MockChatPet = {
  accent: '#C9604F',
  id: 'mock-pet-solo',
  memberCount: 1,
  memberNameKeys: ['chat.preview.mock.members.lenny'],
  name: '豆豆',
};

function mockInstant(
  now: Date,
  dayOffset: number,
  localTime: string,
  timeZone = CHAT_MOCK_TIME_ZONE,
) {
  const today = getDateOnlyInZone(now, timeZone);
  const dateOnly = addDateOnlyDays(today, dayOffset);
  const instant = localDateTimeToInstant(dateOnly, localTime, timeZone);

  if (!instant) {
    throw new Error(`Invalid mock chat time: ${dateOnly} ${localTime}`);
  }

  return instant.toISOString();
}

function message(
  petId: string,
  now: Date,
  input: Omit<MockChatMessage, 'createdAt' | 'petId'> & {
    dayOffset: number;
    localTime: string;
  },
): MockChatMessage {
  const { dayOffset, localTime, ...rest } = input;
  return {
    ...rest,
    createdAt: mockInstant(now, dayOffset, localTime),
    petId,
  };
}

function activeMessages(petId: string, now: Date): MockChatMessage[] {
  const isMochi = petId === 'mock-pet-mochi';
  const petKey = isMochi ? 'mochi' : 'doudou';

  return [
    message(petId, now, {
      authorId: 'mum',
      authorNameKey: 'chat.preview.mock.members.mum',
      bodyKey: `chat.preview.mock.${petKey}.yesterdayMeal`,
      dayOffset: -1,
      id: `${petId}-midnight-before`,
      isOwn: false,
      localTime: '23:59',
      type: 'text',
    }),
    message(petId, now, {
      authorId: 'self',
      authorNameKey: null,
      bodyKey: `chat.preview.mock.${petKey}.midnightReply`,
      dayOffset: 0,
      id: `${petId}-midnight-after`,
      isOwn: true,
      localTime: '00:01',
      type: 'text',
    }),
    message(petId, now, {
      authorId: null,
      authorNameKey: null,
      bodyKey: `chat.preview.mock.${petKey}.joinedSystem`,
      dayOffset: 0,
      id: `${petId}-joined`,
      isOwn: false,
      localTime: '08:30',
      type: 'system',
    }),
    message(petId, now, {
      authorId: 'mum',
      authorNameKey: 'chat.preview.mock.members.mum',
      bodyKey: `chat.preview.mock.${petKey}.appetite`,
      dayOffset: 0,
      id: `${petId}-appetite`,
      isOwn: false,
      localTime: '08:42',
      type: 'text',
    }),
    message(petId, now, {
      authorId: 'mum',
      authorNameKey: 'chat.preview.mock.members.mum',
      bodyKey: `chat.preview.mock.${petKey}.walkQuestion`,
      dayOffset: 0,
      id: `${petId}-walk-question`,
      isOwn: false,
      localTime: '08:44',
      type: 'text',
    }),
    message(petId, now, {
      authorId: 'self',
      authorNameKey: null,
      bodyKey: `chat.preview.mock.${petKey}.walkReply`,
      dayOffset: 0,
      id: `${petId}-walk-reply`,
      isOwn: true,
      localTime: '08:46',
      type: 'text',
    }),
    message(petId, now, {
      authorId: 'sister',
      authorNameKey: 'chat.preview.mock.members.sister',
      bodyKey: 'chat.preview.mock.images.caption',
      dayOffset: 0,
      id: `${petId}-photos`,
      imageIds: ['harbourWalk', 'petPortrait'],
      isOwn: false,
      localTime: '11:18',
      type: 'image',
    }),
    message(petId, now, {
      authorId: null,
      authorNameKey: null,
      bodyKey: `chat.preview.mock.${petKey}.careSystem`,
      dayOffset: 0,
      id: `${petId}-care`,
      isOwn: false,
      localTime: '12:05',
      type: 'care',
    }),
    message(petId, now, {
      authorId: 'dad',
      authorNameKey: 'chat.preview.mock.members.dad',
      bodyKey: `chat.preview.mock.${petKey}.afternoon`,
      dayOffset: 0,
      id: `${petId}-afternoon`,
      isOwn: false,
      localTime: '15:22',
      startsUnread: true,
      type: 'text',
    }),
    message(petId, now, {
      authorId: null,
      authorNameKey: null,
      bodyKey: `chat.preview.mock.${petKey}.reminderSystem`,
      dayOffset: 0,
      id: `${petId}-reminder`,
      isOwn: false,
      localTime: '18:20',
      type: 'reminder',
    }),
    message(petId, now, {
      authorId: 'self',
      authorNameKey: null,
      bodyKey: `chat.preview.mock.${petKey}.evening`,
      dayOffset: 0,
      id: `${petId}-evening`,
      isOwn: true,
      localTime: '19:10',
      type: 'text',
    }),
  ];
}

function longMessages(petId: string, now: Date): MockChatMessage[] {
  return [
    message(petId, now, {
      authorId: 'mum',
      authorNameKey: 'chat.preview.mock.members.mum',
      bodyKey: 'chat.preview.mock.long.body',
      dayOffset: 0,
      id: `${petId}-long`,
      isOwn: false,
      localTime: '09:15',
      type: 'text',
    }),
    message(petId, now, {
      authorId: 'self',
      authorNameKey: null,
      bodyKey: 'chat.preview.mock.long.emojiReply',
      dayOffset: 0,
      id: `${petId}-long-reply`,
      isOwn: true,
      localTime: '09:18',
      type: 'text',
    }),
  ];
}

function imageMessages(petId: string, now: Date): MockChatMessage[] {
  return [
    message(petId, now, {
      authorId: 'mum',
      authorNameKey: 'chat.preview.mock.members.mum',
      bodyKey: 'chat.preview.mock.images.single',
      dayOffset: 0,
      id: `${petId}-single-image`,
      imageIds: ['cozyMeal'],
      isOwn: false,
      localTime: '10:10',
      type: 'image',
    }),
    message(petId, now, {
      authorId: 'sister',
      authorNameKey: 'chat.preview.mock.members.sister',
      bodyKey: 'chat.preview.mock.images.double',
      dayOffset: 0,
      id: `${petId}-double-image`,
      imageIds: ['harbourWalk', 'petPortrait'],
      isOwn: false,
      localTime: '10:14',
      type: 'image',
    }),
    message(petId, now, {
      authorId: 'self',
      authorNameKey: null,
      bodyKey: 'chat.preview.mock.images.grid',
      dayOffset: 0,
      id: `${petId}-grid-image`,
      imageIds: ['cozyMeal', 'harbourWalk', 'petPortrait', 'cozyMeal'],
      isOwn: true,
      localTime: '10:19',
      type: 'image',
    }),
  ];
}

function systemMessages(petId: string, now: Date): MockChatMessage[] {
  return [
    message(petId, now, {
      authorId: 'mum',
      authorNameKey: 'chat.preview.mock.members.mum',
      bodyKey: 'chat.preview.mock.system.contextBefore',
      dayOffset: 0,
      id: `${petId}-context-before`,
      isOwn: false,
      localTime: '08:02',
      type: 'text',
    }),
    message(petId, now, {
      authorId: null,
      authorNameKey: null,
      bodyKey: 'chat.preview.mock.system.memberJoined',
      dayOffset: 0,
      id: `${petId}-member-system`,
      isOwn: false,
      localTime: '08:05',
      type: 'system',
    }),
    message(petId, now, {
      authorId: null,
      authorNameKey: null,
      bodyKey: 'chat.preview.mock.system.careFeed',
      dayOffset: 0,
      id: `${petId}-feed-system`,
      isOwn: false,
      localTime: '08:40',
      type: 'care',
    }),
    message(petId, now, {
      authorId: 'sister',
      authorNameKey: 'chat.preview.mock.members.sister',
      bodyKey: 'chat.preview.mock.system.contextMiddle',
      dayOffset: 0,
      id: `${petId}-context-middle`,
      isOwn: false,
      localTime: '09:12',
      type: 'text',
    }),
    message(petId, now, {
      authorId: null,
      authorNameKey: null,
      bodyKey: 'chat.preview.mock.system.careWalk',
      dayOffset: 0,
      id: `${petId}-walk-system`,
      isOwn: false,
      localTime: '12:32',
      type: 'care',
    }),
    message(petId, now, {
      authorId: null,
      authorNameKey: null,
      bodyKey: 'chat.preview.mock.system.reminderMedicine',
      dayOffset: 0,
      id: `${petId}-medicine-system`,
      isOwn: false,
      localTime: '20:04',
      type: 'reminder',
    }),
    message(petId, now, {
      authorId: 'self',
      authorNameKey: null,
      bodyKey: 'chat.preview.mock.system.contextAfter',
      dayOffset: 0,
      id: `${petId}-context-after`,
      isOwn: true,
      localTime: '20:08',
      type: 'text',
    }),
  ];
}

export function createPerformanceMessages(
  petId: string,
  now = new Date(),
): MockChatMessage[] {
  return Array.from({ length: 100 }, (_, index) => {
    const isOwn = index % 3 === 0;
    const authorKind = index % 2 === 0 ? 'mum' : 'sister';
    const dayOffset = index < 20 ? -2 : index < 55 ? -1 : 0;
    const minute = (index * 7) % (12 * 60);
    const hour = 8 + Math.floor(minute / 60);
    const minuteWithinHour = minute % 60;

    return message(petId, now, {
      authorId: isOwn ? 'self' : authorKind,
      authorNameKey: isOwn ? null : `chat.preview.mock.members.${authorKind}`,
      bodyKey: `chat.preview.mock.performance.line${index % 4}`,
      dayOffset,
      id: `${petId}-performance-${index}`,
      isOwn,
      localTime: `${String(hour).padStart(2, '0')}:${String(
        minuteWithinHour,
      ).padStart(2, '0')}`,
      type: 'text',
    });
  });
}

export function createEarlierMessages(
  petId: string,
  now = new Date(),
): MockChatMessage[] {
  return Array.from({ length: 12 }, (_, index) =>
    message(petId, now, {
      authorId: index % 3 === 0 ? 'self' : 'mum',
      authorNameKey: index % 3 === 0 ? null : 'chat.preview.mock.members.mum',
      bodyKey: `chat.preview.mock.performance.line${index % 4}`,
      dayOffset: -2,
      id: `${petId}-earlier-${index}`,
      isOwn: index % 3 === 0,
      localTime: `${String(8 + Math.floor(index / 4)).padStart(2, '0')}:${String(
        (index * 11) % 60,
      ).padStart(2, '0')}`,
      type: 'text',
    }),
  );
}

export function createMockMessages(
  petId: string,
  story: ChatPreviewStory,
  now = new Date(),
): MockChatMessage[] {
  switch (story) {
    case 'active':
    case 'keyboard':
    case 'maxDynamicType':
      return activeMessages(petId, now);
    case 'longMessage':
      return longMessages(petId, now);
    case 'multiImage':
      return imageMessages(petId, now);
    case 'systemCare':
      return systemMessages(petId, now);
    case 'performance':
      return createPerformanceMessages(petId, now);
    default:
      return [];
  }
}
