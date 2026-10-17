import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type SessionState = {
  selectedId: string | null;
  selectBot: (id: string) => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      selectedId: null,
      selectBot: (id) => set({ selectedId: id }),
    }),
    { name: 'frequi-terminal-selected' },
  ),
);
