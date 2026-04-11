import { create } from 'zustand';
import { BoardSelectorState } from '../types/board-selector';

export type LspStatus = 'idle' | 'starting' | 'ready' | 'error' | 'not_installed';

export interface LspLog {
  dir: 'in' | 'out' | 'info' | 'err';
  msg: string;
  time: string;
}

export interface OpenTab {
  path: string;
  name: string;
}

export interface FeatureDiagnostic {
  crate_name: string;
  missing_feature: string;
  file: string;
  line: number;
  help: string;
}

export interface StandardDiagnostic {
  level: string;
  message: string;
  file: string;
  line: number;
  column: number;
}

interface EditorState {
  activeFile: string | null;
  content: string;
  openTabs: OpenTab[];
  logs: string[];
  lspStatus: LspStatus;
  lspLogs: LspLog[];
  isBuilding: boolean;
  featureDiagnostics: FeatureDiagnostic[];
  standardErrors: StandardDiagnostic[];
  setActiveFile: (file: string | null) => void;
  setContent: (content: string) => void;
  addOpenTab: (tab: OpenTab) => void;
  removeOpenTab: (path: string) => void;
  addLog: (log: string) => void;
  clearLogs: () => void;
  setLspStatus: (status: LspStatus) => void;
  addLspLog: (log: LspLog) => void;
  clearLspLogs: () => void;
  setIsBuilding: (status: boolean) => void;
  setFeatureDiagnostics: (diags: FeatureDiagnostic[]) => void;
  setStandardErrors: (errors: StandardDiagnostic[]) => void;
}

interface ProjectState {
  activeProjectPath: string | null;
  activeProjectName: string | null;
  isWizardOpen: boolean;
  setActiveProject: (path: string | null, name: string | null) => void;
  setWizardOpen: (open: boolean) => void;
}

export const useIDEStore = create<EditorState & BoardSelectorState & ProjectState>((set) => ({
  activeFile: null,
  content: '// Bem-vindo ao Rusteon IDE\n// Abra um projeto para começar',
  openTabs: [],
  logs: ['Rusteon IDE inicializada...'],
  lspStatus: 'idle',
  lspLogs: [],
  isBuilding: false,
  featureDiagnostics: [],
  standardErrors: [],
  setActiveFile: (file) => set({ activeFile: file }),
  setContent: (content) => set({ content }),
  addOpenTab: (tab) => set((state) => {
    if (state.openTabs.some(t => t.path === tab.path)) return {};
    return { openTabs: [...state.openTabs, tab] };
  }),
  removeOpenTab: (path) => set((state) => {
    const newTabs = state.openTabs.filter(t => t.path !== path);
    if (state.activeFile === path) {
      const newActive = newTabs.length > 0 ? newTabs[newTabs.length - 1].path : null;
      return { openTabs: newTabs, activeFile: newActive };
    }
    return { openTabs: newTabs };
  }),
  addLog: (log) => set((state) => ({ logs: [...state.logs, `[${new Date().toLocaleTimeString()}] ${log}`] })),
  clearLogs: () => set({ logs: [] }),
  setLspStatus: (status) => set({ lspStatus: status }),
  addLspLog: (log) => set((state) => {
    const next = [...state.lspLogs, log];
    return { lspLogs: next.length > 200 ? next.slice(next.length - 200) : next };
  }),
  clearLspLogs: () => set({ lspLogs: [] }),
  setIsBuilding: (status) => set({ isBuilding: status }),
  setFeatureDiagnostics: (diags) => set({ featureDiagnostics: diags }),
  setStandardErrors: (errors) => set({ standardErrors: errors }),
  
  // Project state
  activeProjectPath: null,
  activeProjectName: null,
  isWizardOpen: false,
  setActiveProject: (path, name) => set({ activeProjectPath: path, activeProjectName: name }),
  setWizardOpen: (open) => set({ isWizardOpen: open }),
  
  // Board selector state
  serialDialogOpen: false,
  boardDialogOpen: false,
  boardPortDialogOpen: false,
  selectedPort: null,
  selectedBoard: null,
  serialBaudRate: 115200,
  serialConnected: false,
  
  // Board selector actions
  setSerialDialogOpen: (open) => set({ serialDialogOpen: open }),
  setBoardDialogOpen: (open) => set({ boardDialogOpen: open }),
  setBoardPortDialogOpen: (open) => set({ boardPortDialogOpen: open }),
  setSelectedPort: (port) => set({ selectedPort: port }),
  setSelectedBoard: (board) => set({ selectedBoard: board }),
  setSerialBaudRate: (baud) => set({ serialBaudRate: baud }),
  setSerialConnected: (connected) => set({ serialConnected: connected }),
}));
