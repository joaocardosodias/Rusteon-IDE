import { create } from 'zustand';

export type DebugState = 'idle' | 'building' | 'launching' | 'running' | 'paused' | 'stopped' | 'error';

interface DebugStore {
  state: DebugState;
  port: number | null;
  errorMsg: string | null;
  breakpoints: Record<string, number[]>;
  activeLine: { path: string; line: number } | null;
  
  // Setters
  setState: (state: DebugState) => void;
  setPort: (port: number | null) => void;
  setError: (msg: string | null) => void;
  toggleBreakpoint: (path: string, line: number) => void;
  setActiveLine: (path: string | null, line: number | null) => void;
  reset: () => void;
}

export const useDebugStore = create<DebugStore>((set) => ({
  state: 'idle',
  port: null,
  errorMsg: null,
  breakpoints: {},
  activeLine: null,

  setState: (state) => set({ state }),
  setPort: (port) => set({ port }),
  setError: (msg) => set({ errorMsg: msg, state: msg ? 'error' : 'idle' }),
  
  toggleBreakpoint: (path, line) =>
    set((store) => {
      const fileBps = store.breakpoints[path] || [];
      const newBps = fileBps.includes(line)
        ? fileBps.filter((l) => l !== line)
        : [...fileBps, line];
      
      return {
        breakpoints: {
          ...store.breakpoints,
          [path]: newBps,
        },
      };
    }),
    
  setActiveLine: (path, line) => set({ activeLine: path && line ? { path, line } : null }),
  
  reset: () =>
    set({
      state: 'idle',
      port: null,
      errorMsg: null,
      activeLine: null,
    }),
}));
