import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { requireSupabase } from '@/lib/supabase/client';
import type { Pet, PetUpdate } from '@/types/database';
import { syncCareTaskNotifications } from '@/services/care-task-notifications';

import { createPetAvatarSignedUrl } from './pet-avatar';
import type { PetFormValues } from './pet-schema';

export const petKeys = {
  all: (userId: string | undefined) => ['pets', userId] as const,
  avatar: (userId: string | undefined, objectPath: string | null) =>
    ['pet-avatar', userId, objectPath] as const,
  detail: (userId: string | undefined, petId: string) =>
    ['pet', userId, petId] as const,
};

function formValuesToPetInput(values: PetFormValues) {
  return {
    adoption_date: values.adoptionDate || null,
    birthday: values.birthday || null,
    breed: values.breed || null,
    description: values.description || null,
    gender: values.gender,
    name: values.name,
    species: values.species,
    weight: values.weight ? Number(values.weight) : null,
  } satisfies PetUpdate;
}

async function fetchPets() {
  const { data, error } = await requireSupabase()
    .from('pets')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return data;
}

async function fetchPet(petId: string) {
  const { data, error } = await requireSupabase()
    .from('pets')
    .select('*')
    .eq('id', petId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function createPet(values: PetFormValues) {
  const input = formValuesToPetInput(values);
  const { data, error } = await requireSupabase().rpc('create_pet', {
    pet_adoption_date: input.adoption_date,
    pet_birthday: input.birthday,
    pet_breed: input.breed,
    pet_description: input.description,
    pet_gender: input.gender,
    pet_name: input.name ?? '',
    pet_species: input.species ?? 'other',
    pet_weight: input.weight,
  });

  if (error) {
    throw error;
  }

  return data;
}

async function updatePet(petId: string, values: PetFormValues) {
  const { data, error } = await requireSupabase()
    .from('pets')
    .update(formValuesToPetInput(values))
    .eq('id', petId)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function updatePetAvatarPath(
  petId: string,
  avatarPath: string | null,
) {
  const { data, error } = await requireSupabase()
    .from('pets')
    .update({ avatar_path: avatarPath })
    .eq('id', petId)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function deletePet(petId: string) {
  const { data, error } = await requireSupabase().functions.invoke<{
    avatarCleanupPending?: boolean;
    deleted: boolean;
  }>('delete-pet', {
    body: { petId },
  });

  if (error || !data?.deleted) {
    throw error ?? new Error('PET_DELETE_FAILED');
  }

  return data;
}

export function usePets() {
  const { user } = useAuth();

  return useQuery({
    enabled: Boolean(user),
    queryFn: fetchPets,
    queryKey: petKeys.all(user?.id),
  });
}

export function usePet(petId: string) {
  const { user } = useAuth();

  return useQuery({
    enabled: Boolean(user && petId),
    queryFn: () => fetchPet(petId),
    queryKey: petKeys.detail(user?.id, petId),
  });
}

export function usePetAvatarUrl(objectPath: string | null) {
  const { user } = useAuth();

  return useQuery({
    enabled: Boolean(user && objectPath),
    gcTime: 3_600_000,
    queryFn: () => createPetAvatarSignedUrl(objectPath!),
    queryKey: petKeys.avatar(user?.id, objectPath),
    staleTime: 3_000_000,
  });
}

export function useCreatePet() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createPet,
    onSuccess: (pet) => {
      queryClient.setQueryData<Pet[]>(petKeys.all(user?.id), (pets = []) => [
        ...pets,
        pet,
      ]);
      queryClient.setQueryData(petKeys.detail(user?.id, pet.id), pet);
    },
  });
}

export function useUpdatePet(petId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: PetFormValues) => updatePet(petId, values),
    onSuccess: (pet) => {
      queryClient.setQueryData(petKeys.detail(user?.id, pet.id), pet);
      queryClient.setQueryData<Pet[]>(petKeys.all(user?.id), (pets = []) =>
        pets.map((candidate) => (candidate.id === pet.id ? pet : candidate)),
      );
    },
  });
}

export function useDeletePet() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deletePet,
    onSuccess: (_result, petId) => {
      queryClient.removeQueries({ queryKey: petKeys.detail(user?.id, petId) });
      queryClient.setQueryData<Pet[]>(petKeys.all(user?.id), (pets = []) =>
        pets.filter((pet) => pet.id !== petId),
      );
      if (user) {
        void syncCareTaskNotifications(user.id).catch(() => undefined);
      }
    },
  });
}

export function refreshPetQueries(userId: string | undefined) {
  return { queryKey: petKeys.all(userId) };
}
