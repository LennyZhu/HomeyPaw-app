import { create } from 'zustand';

import type { JournalDateRange } from './journal-browsing';

type JournalFilterState = {
  filters: Record<string, JournalDateRange | undefined>;
  setFilter: (contextKey: string, range: JournalDateRange | undefined) => void;
};

export const useJournalFilterStore = create<JournalFilterState>((set) => ({
  filters: {},
  setFilter: (contextKey, range) =>
    set((state) => ({
      filters: { ...state.filters, [contextKey]: range },
    })),
}));
