import { create } from 'zustand';

export type DebugState = 'idle' | 'building' | 'launching' | 'running' | 'paused' | 'stopped' | 'error';

interface DebugStore {
  state: DebugState;
  port: number | null;
  errorMsg: string | null;
  breakpoints: number[];
  activeLine: number | null;
  
  // Setters
  setState: (state: DebugState) => void;
  setPort: (port: number | null) => void;
  setError: (msg: string | null) => void;
  toggleBreakpoint: (line: number) => void;
  setActiveLine: (line: number | null) => void;
  reset: () => void;
}

export const useDebugStore = create<DebugStore>((set) => ({
  state: 'idle',
  port: null,
  errorMsg: null,
  breakpoints: [],
  activeLine: null,

  setState: (state) => set({ state }),
  setPort: (port) => set({ port }),
  setError: (msg) => set({ errorMsg: msg, state: msg ? 'error' : 'idle' }),
  toggleBreakpoint: (line) =>
    set((store) => {
      const bps = store.breakpoints.includes(line)
        ? store.breakpoints.filter((l) => l !== line)
        : [...store.breakpoints, line];
      return { breakpoints: bps };
    }),
  setActiveLine: (line) => set({ activeLine: line }),
  reset: () =>
    set({
      state: 'idle',
      port: null,
      errorMsg: null,
      activeLine: null,
    }),
}));
