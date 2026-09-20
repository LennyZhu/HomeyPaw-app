import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { petKeys } from '@/features/pets/pet-queries';
import { createProfileAvatarSignedUrls } from '@/features/profile/profile-avatar';
import { requireSupabase } from '@/lib/supabase/client';
import { syncCareTaskNotifications } from '@/services/care-task-notifications';
import type { PetMemberRole, PetSpecies } from '@/types/database';

import type {
  AccessibleFamily,
  Family,
  FamilyInvite,
  FamilyMember,
  FamilyPet,
} from './family-types';
import { familyKeys } from './family-query-keys';

export { familyKeys } from './family-query-keys';

export type PetMemberSummary = {
  avatarPath: string | null;
  avatarUrl: string | null;
  displayName: string;
  joinedAt: string;
  role: PetMemberRole;
  userId: string;
};

export type PetPostAuthor = {
  displayName: string;
  userId: string;
};

export type InvitePreview = {
  avatarUrl: string | null;
  inviterDisplayName: string;
  petBreed: string | null;
  petName: string;
  petSpecies: PetSpecies;
};

export type CreatedPetInvite = {
  code: string;
  createdAt: string;
  expiresAt: string;
  id: string;
  maxUses: number;
  usedCount: number;
};

export type JoinPetResult = {
  familyId: string;
  petId: string;
  petName: string;
  status: 'already_member' | 'joined';
};

export const petFamilyKeys = {
  activeInvite: (userId: string | undefined, petId: string) =>
    ['family', userId, 'invite', petId] as const,
  invitePreview: (userId: string | undefined, code: string) =>
    ['family', userId, 'invite-preview', code] as const,
  members: (userId: string | undefined, petId: string) =>
    ['family', userId, 'members', petId] as const,
  postAuthors: (userId: string | undefined, petId: string) =>
    ['family', userId, 'post-authors', petId] as const,
};

type FamilyMembershipJoin = FamilyMember & { families: Family };

async function fetchFamilies(userId: string): Promise<AccessibleFamily[]> {
  const { data, error } = await requireSupabase()
    .from('family_members')
    .select('created_at, family_id, role, user_id, families!inner(*)')
    .eq('user_id', userId);

  if (error) throw error;

  return (data as FamilyMembershipJoin[])
    .map(({ families: family, ...membership }) => ({ family, membership }))
    .sort(
      (left, right) =>
        left.family.created_at.localeCompare(right.family.created_at) ||
        left.family.id.localeCompare(right.family.id),
    );
}

async function fetchFamily(familyId: string): Promise<Family | null> {
  const { data, error } = await requireSupabase()
    .from('families')
    .select('*')
    .eq('id', familyId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function fetchFamilyMembers(familyId: string): Promise<FamilyMember[]> {
  const { data, error } = await requireSupabase()
    .from('family_members')
    .select('*')
    .eq('family_id', familyId)
    .order('created_at', { ascending: true })
    .order('user_id', { ascending: true });

  if (error) throw error;
  return data;
}

async function fetchFamilyPets(familyId: string): Promise<FamilyPet[]> {
  const { data, error } = await requireSupabase()
    .from('pets')
    .select('*')
    .eq('family_id', familyId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw error;
  return data as FamilyPet[];
}

export function useFamilies() {
  const { user } = useAuth();

  return useQuery({
    enabled: Boolean(user),
    queryFn: () => fetchFamilies(user!.id),
    queryKey: familyKeys.list(user?.id),
  });
}

export function useFamily(familyId: string | null) {
  const { user } = useAuth();

  return useQuery({
    enabled: Boolean(user && familyId),
    queryFn: () => fetchFamily(familyId!),
    queryKey: familyKeys.detail(user?.id, familyId ?? ''),
  });
}

export function useFamilyMembers(familyId: string | null) {
  const { user } = useAuth();

  return useQuery({
    enabled: Boolean(user && familyId),
    queryFn: () => fetchFamilyMembers(familyId!),
    queryKey: familyKeys.members(user?.id, familyId ?? ''),
  });
}

export function useFamilyPets(familyId: string | null) {
  const { user } = useAuth();

  return useQuery({
    enabled: Boolean(user && familyId),
    queryFn: () => fetchFamilyPets(familyId!),
    queryKey: familyKeys.pets(user?.id, familyId ?? ''),
  });
}

export function removeFamilyQueries(
  queryClient: QueryClient,
  userId: string,
  familyId?: string,
) {
  if (!familyId) {
    queryClient.removeQueries({ queryKey: familyKeys.all(userId) });
    return;
  }

  queryClient.removeQueries({ queryKey: familyKeys.detail(userId, familyId) });
  queryClient.removeQueries({ queryKey: familyKeys.members(userId, familyId) });
  queryClient.removeQueries({ queryKey: familyKeys.pets(userId, familyId) });
}

function normalizeInviteCode(code: string) {
  return code.trim().toUpperCase();
}

async function fetchPetMembers(
  petId: string,
  queryClient: QueryClient,
): Promise<PetMemberSummary[]> {
  const { data, error } = await requireSupabase().rpc('get_pet_members', {
    target_pet_id: petId,
  });

  if (error) {
    throw error;
  }

  const avatarPaths = data.flatMap((member) =>
    member.member_avatar_path ? [member.member_avatar_path] : [],
  );
  const signedUrls = await createProfileAvatarSignedUrls(
    queryClient,
    avatarPaths,
  ).catch(() => ({}) as Record<string, string>);

  return data.map((member) => ({
    avatarPath: member.member_avatar_path,
    avatarUrl: member.member_avatar_path
      ? (signedUrls[member.member_avatar_path] ?? null)
      : null,
    displayName: member.member_display_name,
    joinedAt: member.member_joined_at,
    role: member.member_role,
    userId: member.member_user_id,
  }));
}

async function fetchPostAuthors(petId: string): Promise<PetPostAuthor[]> {
  const { data, error } = await requireSupabase().rpc('get_pet_post_authors', {
    target_pet_id: petId,
  });

  if (error) {
    throw error;
  }

  return data.map((author) => ({
    displayName: author.author_display_name,
    userId: author.author_user_id,
  }));
}

async function resolvePetFamilyId(petId: string): Promise<string> {
  const { data, error } = await requireSupabase()
    .from('pets')
    .select('family_id')
    .eq('id', petId)
    .maybeSingle();

  if (error || !data?.family_id) {
    throw error ?? new Error('PET_FAMILY_MISSING');
  }

  return data.family_id;
}

async function fetchActiveInvite(petId: string): Promise<FamilyInvite | null> {
  const familyId = await resolvePetFamilyId(petId);
  const { data, error } = await requireSupabase()
    .from('family_invites')
    .select(
      'id, family_id, invited_by, expires_at, max_uses, used_count, revoked_at, created_at',
    )
    .eq('family_id', familyId)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function createInvite(
  petId: string,
): Promise<CreatedPetInvite & { familyId: string }> {
  const familyId = await resolvePetFamilyId(petId);
  const { data, error } = await requireSupabase().rpc('create_family_invite', {
    target_family_id: familyId,
  });

  if (error || !data[0]) {
    throw error ?? new Error('INVITE_CREATE_FAILED');
  }

  const invite = data[0];
  return {
    code: invite.invite_code,
    createdAt: invite.invite_created_at,
    expiresAt: invite.invite_expires_at,
    familyId,
    id: invite.invite_id,
    maxUses: invite.invite_max_uses,
    usedCount: invite.invite_used_count,
  };
}

async function revokeInvite(petId: string) {
  const familyId = await resolvePetFamilyId(petId);
  const { data, error } = await requireSupabase().rpc('revoke_family_invite', {
    target_family_id: familyId,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function previewInvite(code: string): Promise<InvitePreview> {
  const { data, error } =
    await requireSupabase().functions.invoke<InvitePreview>(
      'preview-pet-invite',
      { body: { code: normalizeInviteCode(code) } },
    );

  if (error || !data) {
    throw error ?? new Error('INVITE_INVALID');
  }

  return data;
}

async function joinPet(code: string): Promise<JoinPetResult> {
  const { data, error } = await requireSupabase().rpc(
    'join_family_with_invite',
    { invite_code: normalizeInviteCode(code) },
  );

  if (error || !data[0]) {
    throw error ?? new Error('INVITE_INVALID');
  }

  return {
    familyId: data[0].joined_family_id,
    petId: data[0].display_pet_id,
    petName: data[0].display_pet_name,
    status: data[0].join_status,
  };
}

async function removeMember(petId: string, userId: string) {
  const familyId = await resolvePetFamilyId(petId);
  const { data, error } = await requireSupabase().rpc('remove_family_member', {
    target_family_id: familyId,
    target_user_id: userId,
  });

  if (error) {
    throw error;
  }

  return { familyId, status: data };
}

export function usePetMembers(petId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useQuery({
    enabled: Boolean(user && petId),
    queryFn: () => fetchPetMembers(petId!, queryClient),
    queryKey: petFamilyKeys.members(user?.id, petId ?? ''),
  });
}

export function usePetPostAuthors(petId: string | null) {
  const { user } = useAuth();

  return useQuery({
    enabled: Boolean(user && petId),
    queryFn: () => fetchPostAuthors(petId!),
    queryKey: petFamilyKeys.postAuthors(user?.id, petId ?? ''),
  });
}

export function useActivePetInvite(petId: string, isOwner: boolean) {
  const { user } = useAuth();

  return useQuery({
    enabled: Boolean(user && petId && isOwner),
    queryFn: () => fetchActiveInvite(petId),
    queryKey: petFamilyKeys.activeInvite(user?.id, petId),
  });
}

export function useCreatePetInvite(petId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createInvite(petId),
    onSuccess: (invite) => {
      queryClient.setQueriesData(
        { queryKey: ['family', user?.id, 'invite'] },
        null,
      );
      queryClient.setQueryData<FamilyInvite>(
        petFamilyKeys.activeInvite(user?.id, petId),
        {
          created_at: invite.createdAt,
          expires_at: invite.expiresAt,
          family_id: invite.familyId,
          id: invite.id,
          invited_by: user!.id,
          max_uses: invite.maxUses,
          revoked_at: null,
          used_count: invite.usedCount,
        },
      );
    },
  });
}

export function useRevokePetInvite(petId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => revokeInvite(petId),
    onSuccess: () => {
      queryClient.setQueriesData(
        { queryKey: ['family', user?.id, 'invite'] },
        null,
      );
    },
  });
}

export function useJoinPet() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: joinPet,
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: petKeys.all(user?.id) }),
        queryClient.invalidateQueries({
          queryKey: familyKeys.list(user?.id),
        }),
        queryClient.invalidateQueries({
          queryKey: familyKeys.pets(user?.id, result.familyId),
        }),
        queryClient.invalidateQueries({
          queryKey: familyKeys.members(user?.id, result.familyId),
        }),
        queryClient.invalidateQueries({
          queryKey: ['family', user?.id, 'members'],
        }),
      ]);
      if (user) {
        void syncCareTaskNotifications(user.id).catch(() => undefined);
      }
    },
  });
}

export function useRemovePetMember(petId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberUserId: string) => removeMember(petId, memberUserId),
    onSuccess: async (result) => {
      queryClient.setQueriesData(
        { queryKey: ['family', user?.id, 'invite'] },
        null,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: familyKeys.members(user?.id, result.familyId),
        }),
        queryClient.invalidateQueries({
          queryKey: ['family', user?.id, 'members'],
        }),
      ]);
      if (user) {
        void syncCareTaskNotifications(user.id).catch(() => undefined);
      }
    },
  });
}
