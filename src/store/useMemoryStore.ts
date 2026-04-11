import { create } from 'zustand';

export interface MemorySnapshot {
  heap: number;    // bytes used on heap
  stack: number;   // bytes used on stack
  free: number;    // bytes free
  total: number;   // total RAM (heap + stack + free)
  timestamp: number;
}

interface MemoryStore {
  latest: MemorySnapshot | null;
  history: MemorySnapshot[];
  active: boolean;           // true when we've received at least one packet
  setSnapshot: (snap: MemorySnapshot) => void;
  reset: () => void;
}

const MAX_HISTORY = 40;

export const useMemoryStore = create<MemoryStore>((set) => ({
  latest: null,
  history: [],
  active: false,

  setSnapshot: (snap) =>
    set((state) => {
      const history = [...state.history, snap];
      return {
        latest: snap,
        active: true,
        history: history.length > MAX_HISTORY ? history.slice(history.length - MAX_HISTORY) : history,
      };
    }),

  reset: () => set({ latest: null, history: [], active: false }),
}));

// ── Telemetry Parser ──────────────────────────────────────────────────────
// Expected format: __RUSTEON_MEM__:{"h":12288,"s":3072,"f":46080}
const MEM_PREFIX = '__RUSTEON_MEM__:';

export function parseTelemetryLine(raw: string): MemorySnapshot | null {
  const idx = raw.indexOf(MEM_PREFIX);
  if (idx === -1) return null;
  try {
    const json = raw.slice(idx + MEM_PREFIX.length).trim();
    const parsed = JSON.parse(json);
    const heap = Number(parsed.h ?? parsed.heap ?? 0);
    const stack = Number(parsed.s ?? parsed.stack ?? 0);
    const free = Number(parsed.f ?? parsed.free ?? 0);
    const total = heap + stack + free;
    return { heap, stack, free, total, timestamp: Date.now() };
  } catch {
    return null;
  }
}
