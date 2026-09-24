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
import {
  useBackendCapability,
  type BackendCapability,
} from './backend-capability';
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
  familyId: string | null;
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
  const capability = useBackendCapability();

  return useQuery({
    enabled: Boolean(user && capability.data === 'FAMILY_MULTI_PET'),
    queryFn: () => fetchFamilies(user!.id),
    queryKey: familyKeys.list(user?.id),
  });
}

export function useFamily(familyId: string | null) {
  const { user } = useAuth();
  const capability = useBackendCapability();

  return useQuery({
    enabled: Boolean(
      user && familyId && capability.data === 'FAMILY_MULTI_PET',
    ),
    queryFn: () => fetchFamily(familyId!),
    queryKey: familyKeys.detail(user?.id, familyId ?? ''),
  });
}

export function useFamilyMembers(familyId: string | null) {
  const { user } = useAuth();
  const capability = useBackendCapability();

  return useQuery({
    enabled: Boolean(
      user && familyId && capability.data === 'FAMILY_MULTI_PET',
    ),
    queryFn: () => fetchFamilyMembers(familyId!),
    queryKey: familyKeys.members(user?.id, familyId ?? ''),
  });
}

export function useFamilyMemberSummaries(familyId: string | null) {
  const { user } = useAuth();
  const capability = useBackendCapability();
  const queryClient = useQueryClient();

  return useQuery({
    enabled: Boolean(
      user && familyId && capability.data === 'FAMILY_MULTI_PET',
    ),
    queryFn: async (): Promise<PetMemberSummary[]> => {
      const { data, error } = await requireSupabase().rpc(
        'get_family_members',
        {
          target_family_id: familyId!,
        },
      );
      if (error) throw error;
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
    },
    queryKey: [...familyKeys.members(user?.id, familyId ?? ''), 'summaries'],
  });
}

export function useFamilyPets(familyId: string | null) {
  const { user } = useAuth();
  const capability = useBackendCapability();

  return useQuery({
    enabled: Boolean(
      user && familyId && capability.data === 'FAMILY_MULTI_PET',
    ),
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
  capability: BackendCapability,
): Promise<PetMemberSummary[]> {
  const { data, error } =
    capability === 'LEGACY_PET'
      ? await requireSupabase().rpc('get_pet_members', {
          target_pet_id: petId,
        })
      : await requireSupabase().rpc('get_family_members', {
          target_family_id: await resolvePetFamilyId(petId),
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

type ActiveInvite = Pick<
  FamilyInvite,
  | 'id'
  | 'invited_by'
  | 'expires_at'
  | 'max_uses'
  | 'used_count'
  | 'revoked_at'
  | 'created_at'
>;

async function fetchActiveInvite(
  petId: string,
  capability: BackendCapability,
): Promise<ActiveInvite | null> {
  if (capability === 'LEGACY_PET') {
    const { data, error } = await requireSupabase()
      .from('pet_invites')
      .select(
        'id, invited_by, expires_at, max_uses, used_count, revoked_at, created_at',
      )
      .eq('pet_id', petId)
      .is('revoked_at', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
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
  capability: BackendCapability,
): Promise<CreatedPetInvite & { familyId: string | null }> {
  const familyId =
    capability === 'LEGACY_PET' ? null : await resolvePetFamilyId(petId);
  const { data, error } =
    capability === 'LEGACY_PET'
      ? await requireSupabase().rpc('create_pet_invite', {
          target_pet_id: petId,
        })
      : await requireSupabase().rpc('create_family_invite', {
          target_family_id: familyId!,
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

async function revokeInvite(petId: string, capability: BackendCapability) {
  const { data, error } =
    capability === 'LEGACY_PET'
      ? await requireSupabase().rpc('revoke_pet_invite', {
          target_pet_id: petId,
        })
      : await requireSupabase().rpc('revoke_family_invite', {
          target_family_id: await resolvePetFamilyId(petId),
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

async function joinPet(
  code: string,
  capability: BackendCapability,
): Promise<JoinPetResult> {
  const { data, error } =
    capability === 'LEGACY_PET'
      ? await requireSupabase().rpc('join_pet_with_invite', {
          invite_code: normalizeInviteCode(code),
        })
      : await requireSupabase().rpc('join_family_with_invite', {
          invite_code: normalizeInviteCode(code),
        });

  if (error || !data[0]) {
    throw error ?? new Error('INVITE_INVALID');
  }

  return {
    familyId:
      capability === 'LEGACY_PET'
        ? null
        : 'joined_family_id' in data[0]
          ? data[0].joined_family_id
          : null,
    petId:
      'joined_pet_id' in data[0]
        ? data[0].joined_pet_id
        : data[0].display_pet_id,
    petName:
      'joined_pet_name' in data[0]
        ? data[0].joined_pet_name
        : data[0].display_pet_name,
    status: data[0].join_status,
  };
}

export async function removeFamilyMember(familyId: string, userId: string) {
  const { data, error } = await requireSupabase().rpc('remove_family_member', {
    target_family_id: familyId,
    target_user_id: userId,
  });

  if (error) {
    throw error;
  }

  return data;
}

async function removeMember(
  petId: string,
  userId: string,
  capability: BackendCapability,
) {
  if (capability === 'LEGACY_PET') {
    const { data, error } = await requireSupabase().rpc('remove_pet_member', {
      target_pet_id: petId,
      target_user_id: userId,
    });
    if (error) throw error;
    return { familyId: null, status: data };
  }
  const familyId = await resolvePetFamilyId(petId);
  const status = await removeFamilyMember(familyId, userId);
  return { familyId, status };
}

export async function leaveFamily(familyId: string) {
  const { data, error } = await requireSupabase().rpc('leave_family', {
    target_family_id: familyId,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function transferFamilyOwnership(
  familyId: string,
  newOwnerUserId: string,
) {
  const { data, error } = await requireSupabase().rpc(
    'transfer_family_ownership',
    {
      new_owner_user_id: newOwnerUserId,
      target_family_id: familyId,
    },
  );

  if (error) {
    throw error;
  }

  return data;
}

export function usePetMembers(petId: string | null) {
  const { user } = useAuth();
  const capability = useBackendCapability();
  const queryClient = useQueryClient();

  return useQuery({
    enabled: Boolean(user && petId && capability.data),
    queryFn: () => fetchPetMembers(petId!, queryClient, capability.data!),
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
  const capability = useBackendCapability();

  return useQuery({
    enabled: Boolean(user && petId && isOwner && capability.data),
    queryFn: () => fetchActiveInvite(petId, capability.data!),
    queryKey: petFamilyKeys.activeInvite(user?.id, petId),
  });
}

export function useCreatePetInvite(petId: string) {
  const { user } = useAuth();
  const capability = useBackendCapability();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!capability.data) throw new Error('BACKEND_CAPABILITY_UNAVAILABLE');
      return createInvite(petId, capability.data);
    },
    onSuccess: (invite) => {
      queryClient.setQueriesData(
        { queryKey: ['family', user?.id, 'invite'] },
        null,
      );
      queryClient.setQueryData<ActiveInvite>(
        petFamilyKeys.activeInvite(user?.id, petId),
        {
          created_at: invite.createdAt,
          expires_at: invite.expiresAt,
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
  const capability = useBackendCapability();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!capability.data) throw new Error('BACKEND_CAPABILITY_UNAVAILABLE');
      return revokeInvite(petId, capability.data);
    },
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
  const capability = useBackendCapability();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (code: string) => {
      if (!capability.data) throw new Error('BACKEND_CAPABILITY_UNAVAILABLE');
      return joinPet(code, capability.data);
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: petKeys.all(user?.id) }),
        queryClient.invalidateQueries({
          queryKey: familyKeys.list(user?.id),
        }),
        queryClient.invalidateQueries({
          queryKey: result.familyId
            ? familyKeys.pets(user?.id, result.familyId)
            : petKeys.all(user?.id),
        }),
        queryClient.invalidateQueries({
          queryKey: result.familyId
            ? familyKeys.members(user?.id, result.familyId)
            : petFamilyKeys.members(user?.id, result.petId),
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
  const capability = useBackendCapability();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberUserId: string) => {
      if (!capability.data) throw new Error('BACKEND_CAPABILITY_UNAVAILABLE');
      return removeMember(petId, memberUserId, capability.data);
    },
    onSuccess: async (result) => {
      queryClient.setQueriesData(
        { queryKey: ['family', user?.id, 'invite'] },
        null,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: result.familyId
            ? familyKeys.members(user?.id, result.familyId)
            : petFamilyKeys.members(user?.id, petId),
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

export function useLeaveFamily() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: leaveFamily,
    onSuccess: async (_status, familyId) => {
      if (!user) return;

      removeFamilyQueries(queryClient, user.id, familyId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: familyKeys.list(user.id) }),
        queryClient.invalidateQueries({ queryKey: petKeys.all(user.id) }),
      ]);
      void syncCareTaskNotifications(user.id).catch(() => undefined);
    },
  });
}

export function useTransferFamilyOwnership(familyId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (newOwnerUserId: string) =>
      transferFamilyOwnership(familyId, newOwnerUserId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: familyKeys.list(user?.id) }),
        queryClient.invalidateQueries({
          queryKey: familyKeys.members(user?.id, familyId),
        }),
        queryClient.invalidateQueries({
          queryKey: ['family', user?.id, 'members'],
        }),
      ]);
    },
  });
}

export function useRemoveFamilyMember(familyId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberUserId: string) =>
      removeFamilyMember(familyId, memberUserId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: familyKeys.members(user?.id, familyId),
        }),
        queryClient.invalidateQueries({
          queryKey: ['family', user?.id, 'members'],
        }),
      ]);
    },
  });
}

export async function deleteFamily(familyId: string) {
  const { data, error } = await requireSupabase().rpc('delete_family', {
    target_family_id: familyId,
  });
  if (error) throw error;
  return data;
}
