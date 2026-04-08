import { create } from 'zustand';

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

export const useIDEStore = create<EditorState>((set) => ({
  activeFile: 'main.rs',
  content: '// Bem-vindo ao Rusteon IDE\nfn main() {\n    println!("Olá, Rust Embarcado!");\n}',
  logs: ['Rusteon IDE inicializada...'],
  isBuilding: false,
  setActiveFile: (file) => set({ activeFile: file }),
  setContent: (content) => set({ content }),
  addLog: (log) => set((state) => ({ logs: [...state.logs, `[${new Date().toLocaleTimeString()}] ${log}`] })),
  clearLogs: () => set({ logs: [] }),
  setIsBuilding: (status) => set({ isBuilding: status }),
}));
