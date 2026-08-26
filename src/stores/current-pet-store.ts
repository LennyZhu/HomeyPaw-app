import type { StateStorage } from 'zustand/middleware';
import { createJSONStorage, persist } from 'zustand/middleware';
import { create } from 'zustand';

type CurrentPetState = {
  currentPetId: string | null;
  setCurrentPetId: (petId: string | null) => void;
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
      setCurrentPetId: (currentPetId) => set({ currentPetId }),
    }),
    {
      name: 'pawday-current-pet',
      partialize: ({ currentPetId }) => ({ currentPetId }),
      storage: createJSONStorage(() => localStorageAdapter),
    },
  ),
);
