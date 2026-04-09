import { create } from 'zustand';
import { BoardSelectorState } from '../types/board-selector';

interface EditorState {
  activeFile: string | null;
  content: string;
  logs: string[];
  isBuilding: boolean;
  setActiveFile: (file: string | null) => void;
  setContent: (content: string) => void;
  addLog: (log: string) => void;
  clearLogs: () => void;
  setIsBuilding: (status: boolean) => void;
}

export const useIDEStore = create<EditorState & BoardSelectorState>((set) => ({
  activeFile: 'main.rs',
  content: '// Bem-vindo ao Rusteon IDE\nfn main() {\n    println!("Olá, Rust Embarcado!");\n}',
  logs: ['Rusteon IDE inicializada...'],
  isBuilding: false,
  setActiveFile: (file) => set({ activeFile: file }),
  setContent: (content) => set({ content }),
  addLog: (log) => set((state) => ({ logs: [...state.logs, `[${new Date().toLocaleTimeString()}] ${log}`] })),
  clearLogs: () => set({ logs: [] }),
  setIsBuilding: (status) => set({ isBuilding: status }),
  
  // Board selector state
  serialDialogOpen: false,
  boardDialogOpen: false,
  boardPortDialogOpen: false,
  selectedPort: null,
  selectedBoard: null,
  
  // Board selector actions
  setSerialDialogOpen: (open) => set({ serialDialogOpen: open }),
  setBoardDialogOpen: (open) => set({ boardDialogOpen: open }),
  setBoardPortDialogOpen: (open) => set({ boardPortDialogOpen: open }),
  setSelectedPort: (port) => set({ selectedPort: port }),
  setSelectedBoard: (board) => set({ selectedBoard: board }),
}));
