import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { petKeys } from '@/features/pets/pet-queries';
import { requireSupabase } from '@/lib/supabase/client';
import { syncCareTaskNotifications } from '@/services/care-task-notifications';
import type { PetInvite, PetMemberRole, PetSpecies } from '@/types/database';

export type PetMemberSummary = {
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
  petId: string;
  petName: string;
  status: 'already_member' | 'joined';
};

export const familyKeys = {
  activeInvite: (userId: string | undefined, petId: string) =>
    ['family', userId, 'invite', petId] as const,
  invitePreview: (userId: string | undefined, code: string) =>
    ['family', userId, 'invite-preview', code] as const,
  members: (userId: string | undefined, petId: string) =>
    ['family', userId, 'members', petId] as const,
  postAuthors: (userId: string | undefined, petId: string) =>
    ['family', userId, 'post-authors', petId] as const,
};

function normalizeInviteCode(code: string) {
  return code.trim().toUpperCase();
}

async function fetchPetMembers(petId: string): Promise<PetMemberSummary[]> {
  const { data, error } = await requireSupabase().rpc('get_pet_members', {
    target_pet_id: petId,
  });

  if (error) {
    throw error;
  }

  return data.map((member) => ({
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

async function fetchActiveInvite(petId: string): Promise<PetInvite | null> {
  const { data, error } = await requireSupabase()
    .from('pet_invites')
    .select(
      'id, pet_id, invited_by, expires_at, max_uses, used_count, revoked_at, created_at',
    )
    .eq('pet_id', petId)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function createInvite(petId: string): Promise<CreatedPetInvite> {
  const { data, error } = await requireSupabase().rpc('create_pet_invite', {
    target_pet_id: petId,
  });

  if (error || !data[0]) {
    throw error ?? new Error('INVITE_CREATE_FAILED');
  }

  const invite = data[0];
  return {
    code: invite.invite_code,
    createdAt: invite.invite_created_at,
    expiresAt: invite.invite_expires_at,
    id: invite.invite_id,
    maxUses: invite.invite_max_uses,
    usedCount: invite.invite_used_count,
  };
}

async function revokeInvite(petId: string) {
  const { data, error } = await requireSupabase().rpc('revoke_pet_invite', {
    target_pet_id: petId,
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
  const { data, error } = await requireSupabase().rpc('join_pet_with_invite', {
    invite_code: normalizeInviteCode(code),
  });

  if (error || !data[0]) {
    throw error ?? new Error('INVITE_INVALID');
  }

  return {
    petId: data[0].joined_pet_id,
    petName: data[0].joined_pet_name,
    status: data[0].join_status,
  };
}

async function removeMember(petId: string, userId: string) {
  const { data, error } = await requireSupabase().rpc('remove_pet_member', {
    target_pet_id: petId,
    target_user_id: userId,
  });

  if (error) {
    throw error;
  }

  return data;
}

export function usePetMembers(petId: string | null) {
  const { user } = useAuth();

  return useQuery({
    enabled: Boolean(user && petId),
    queryFn: () => fetchPetMembers(petId!),
    queryKey: familyKeys.members(user?.id, petId ?? ''),
  });
}

export function usePetPostAuthors(petId: string | null) {
  const { user } = useAuth();

  return useQuery({
    enabled: Boolean(user && petId),
    queryFn: () => fetchPostAuthors(petId!),
    queryKey: familyKeys.postAuthors(user?.id, petId ?? ''),
  });
}

export function useActivePetInvite(petId: string, isOwner: boolean) {
  const { user } = useAuth();

  return useQuery({
    enabled: Boolean(user && petId && isOwner),
    queryFn: () => fetchActiveInvite(petId),
    queryKey: familyKeys.activeInvite(user?.id, petId),
  });
}

export function useCreatePetInvite(petId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createInvite(petId),
    onSuccess: (invite) => {
      queryClient.setQueryData<PetInvite>(
        familyKeys.activeInvite(user?.id, petId),
        {
          created_at: invite.createdAt,
          expires_at: invite.expiresAt,
          id: invite.id,
          invited_by: user!.id,
          max_uses: invite.maxUses,
          pet_id: petId,
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
      queryClient.setQueryData(familyKeys.activeInvite(user?.id, petId), null);
    },
  });
}

export function useJoinPet() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: joinPet,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: petKeys.all(user?.id),
      });
      await queryClient.invalidateQueries({
        queryKey: familyKeys.members(user?.id, result.petId),
      });
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
    onSuccess: async () => {
      queryClient.setQueryData(familyKeys.activeInvite(user?.id, petId), null);
      await queryClient.invalidateQueries({
        queryKey: familyKeys.members(user?.id, petId),
      });
      if (user) {
        void syncCareTaskNotifications(user.id).catch(() => undefined);
      }
    },
  });
}
