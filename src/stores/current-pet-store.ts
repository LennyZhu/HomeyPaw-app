import type { StateStorage } from 'zustand/middleware';
import { createJSONStorage, persist } from 'zustand/middleware';
import { create } from 'zustand';

type CurrentPetState = {
  currentPetId: string | null;
  currentPetUserId: string | null;
  clearCurrentPet: () => void;
  setCurrentPetId: (petId: string | null, userId: string | null) => void;
};

const localStorageAdapter: StateStorage = {
  getItem(name) {
    return globalThis.localStorage?.getItem(name) ?? null;
  },
  removeItem(name) {
    globalThis.localStorage?.removeItem(name);
  },
  setItem(name, value) {
    globalThis.localStorage?.setItem(name, value);
  },
};

export const useCurrentPetStore = create<CurrentPetState>()(
  persist(
    (set) => ({
      currentPetId: null,
      currentPetUserId: null,
      clearCurrentPet: () =>
        set({ currentPetId: null, currentPetUserId: null }),
      setCurrentPetId: (currentPetId, currentPetUserId) =>
        set({ currentPetId, currentPetUserId }),
    }),
    {
      name: 'pawday-current-pet',
      partialize: ({ currentPetId, currentPetUserId }) => ({
        currentPetId,
        currentPetUserId,
      }),
      storage: createJSONStorage(() => localStorageAdapter),
    },
  ),
);
