import type { Database, Pet } from '@/types/database';

export type Family = Database['public']['Tables']['families']['Row'];
export type FamilyMember =
  Database['public']['Tables']['family_members']['Row'];
export type FamilyInvite =
  Database['public']['Tables']['family_invites']['Row'];

export type AccessibleFamily = {
  family: Family;
  membership: FamilyMember;
};

export type FamilyPet = Pet & { family_id: string };
