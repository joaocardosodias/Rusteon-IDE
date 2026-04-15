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
  autoSaveEnabled: boolean;
  rustAnalyzerEnabled: boolean;
  openTabs: OpenTab[];
  logs: string[];
  lspStatus: LspStatus;
  lspLogs: LspLog[];
  isBuilding: boolean;
  featureDiagnostics: FeatureDiagnostic[];
  standardErrors: StandardDiagnostic[];
  setActiveFile: (file: string | null) => void;
  setContent: (content: string) => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
  setRustAnalyzerEnabled: (enabled: boolean) => void;
  addOpenTab: (tab: OpenTab) => void;
  removeOpenTab: (path: string) => void;
  addLog: (log: string) => void;
  addOutputLog: (text: string, type?: "ok" | "err" | "warn" | "dim" | "prompt" | "plain") => void;
  clearLogs: () => void;
  setLspStatus: (status: LspStatus) => void;
  addLspLog: (log: LspLog) => void;
  clearLspLogs: () => void;
  setIsBuilding: (status: boolean) => void;
  setFeatureDiagnostics: (diags: FeatureDiagnostic[]) => void;
  setStandardErrors: (errors: StandardDiagnostic[]) => void;
  alertConfig: { open: boolean; title: string; message: string };
  showAlert: (title: string, message: string) => void;
  closeAlert: () => void;
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
  content: '// Welcome to Rusteon IDE\n// Open a project to get started',
  autoSaveEnabled: true,
  rustAnalyzerEnabled: true,
  openTabs: [],
  logs: ['Rusteon IDE initialized...'],
  lspStatus: 'idle',
  lspLogs: [],
  isBuilding: false,
  featureDiagnostics: [],
  standardErrors: [],
  setActiveFile: (file) => set({ activeFile: file }),
  setContent: (content) => set({ content }),
  setAutoSaveEnabled: (enabled) => set({ autoSaveEnabled: enabled }),
  setRustAnalyzerEnabled: (enabled) => set({ rustAnalyzerEnabled: enabled }),
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
  addLog: (log) => {
    let type = "dim";
    if (log.startsWith("[Error]")) type = "err";
    else if (log.startsWith("✓")) type = "ok";
    else if (log.startsWith(">")) type = "prompt";
    
    window.dispatchEvent(new CustomEvent("ide-global-log", { detail: { text: log, type } }));
  },
  addOutputLog: (text, type = "plain") => {
    window.dispatchEvent(new CustomEvent("ide-global-log", { detail: { text, type } }));
  },
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
  alertConfig: { open: false, title: '', message: '' },
  showAlert: (title, message) => set({ alertConfig: { open: true, title, message } }),
  closeAlert: () => set((state) => ({ alertConfig: { ...state.alertConfig, open: false } })),
  
  // Project state
  activeProjectPath: null,
  activeProjectName: null,
  isWizardOpen: false,
  setActiveProject: (path, name) => set({ 
    activeProjectPath: path, 
    activeProjectName: name,
    openTabs: [],
    activeFile: null,
    content: '// Welcome to Rusteon IDE\n// Open a project to get started'
  }),
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
