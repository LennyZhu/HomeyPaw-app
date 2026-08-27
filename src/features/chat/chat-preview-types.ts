export type ChatPreviewStory =
  | 'active'
  | 'empty'
  | 'noPet'
  | 'singleMember'
  | 'longMessage'
  | 'multiImage'
  | 'systemCare'
  | 'performance'
  | 'keyboard'
  | 'maxDynamicType'
  | 'loading'
  | 'error';

export type MockChatImage = 'cozyMeal' | 'harbourWalk' | 'petPortrait';

export type MockChatMessage = {
  authorId: string | null;
  authorNameKey: string | null;
  body?: string;
  bodyKey?: string;
  createdAt: string;
  id: string;
  imageIds?: MockChatImage[];
  isOwn: boolean;
  petId: string;
  startsUnread?: boolean;
  type: 'text' | 'image' | 'system' | 'care' | 'reminder';
};

export type MockChatPet = {
  accent: string;
  id: string;
  memberCount: number;
  memberNameKeys: string[];
  name: string;
};
