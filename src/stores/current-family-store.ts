import type { StateStorage } from 'zustand/middleware';
import { createJSONStorage, persist } from 'zustand/middleware';
import { create } from 'zustand';

type CurrentFamilyState = {
  currentFamilyId: string | null;
  currentFamilyUserId: string | null;
  clearCurrentFamily: () => void;
  setCurrentFamilyId: (familyId: string | null, userId: string | null) => void;
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

export const useCurrentFamilyStore = create<CurrentFamilyState>()(
  persist(
    (set) => ({
      currentFamilyId: null,
      currentFamilyUserId: null,
      clearCurrentFamily: () =>
        set({ currentFamilyId: null, currentFamilyUserId: null }),
      setCurrentFamilyId: (currentFamilyId, currentFamilyUserId) =>
        set({ currentFamilyId, currentFamilyUserId }),
    }),
    {
      name: 'pawday-current-family',
      partialize: ({ currentFamilyId, currentFamilyUserId }) => ({
        currentFamilyId,
        currentFamilyUserId,
      }),
      storage: createJSONStorage(() => localStorageAdapter),
    },
  ),
);
