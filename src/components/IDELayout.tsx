import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LibraryManager } from "./LibraryManager";
import { BoardManager } from "./BoardManager";
import { Editor } from "./Editor";
import { BoardSelectorButton } from "./BoardSelectorButton";
import { SerialPortDialog } from "./SerialPortDialog";
import { stripAnsi } from "../lib/stripAnsi";
import { BoardPortDialog } from "./BoardPortDialog";
import { AlertDialog } from "./AlertDialog";
import { ProjectExplorer } from "./ProjectExplorer";
import { ProjectWizard } from "./ProjectWizard";
import { useIDEStore } from "../store/useIDEStore";
import { useDebugStore } from "../store/useDebugStore";
import { DapClient } from "../api/dapClient";
import { useMemoryStore, parseTelemetryLine } from "../store/useMemoryStore";
import { MemoryDashboard } from "./MemoryDashboard";
import { DebugToolbar } from "./DebugToolbar";
import { BOARDS } from "../data/boards";
import { getFileIcon } from "../lib/fileIcons";
// Material Icons
import FolderOpenIcon from "@mui/icons-material/FolderOpenOutlined";
import ExtensionIcon from "@mui/icons-material/ExtensionOutlined";
import BoltIcon from "@mui/icons-material/BoltOutlined";
import DeveloperBoardIcon from "@mui/icons-material/DeveloperBoardOutlined";
import SearchIcon from "@mui/icons-material/SearchOutlined";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import UsbIcon from "@mui/icons-material/Usb";
import CloseIcon from "@mui/icons-material/Close";
import CheckIcon from "@mui/icons-material/Check";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import BugReportIcon from "@mui/icons-material/BugReport";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import FolderIcon from "@mui/icons-material/Folder";
import SaveIcon from "@mui/icons-material/Save";
import RefreshIcon from "@mui/icons-material/Refresh";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import SettingsEthernetIcon from "@mui/icons-material/SettingsEthernet";
import KeyboardDoubleArrowDownIcon from "@mui/icons-material/KeyboardDoubleArrowDown";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import MemoryIcon from "@mui/icons-material/Memory";

// ─── Log line types ───────────────────────────────────────────────────────────
type BTab = "out" | "serial" | "errors" | "lsp";
type LogLine = { text: string; type: "ok" | "err" | "warn" | "dim" | "prompt" | "plain"; timestamp?: string };

type ParsedSerialLine = {
  structured: boolean;
  level?: "I" | "W" | "E";
  tick?: string;
  tag?: string;
  topic?: string;
  payload?: string;
  body?: string;
  raw: string;
};

type ParsedFlashProgress = {
  elapsed: string;
  current: number;
  total: number;
  address: string;
  status: string;
  percent: number;
};

function logColor(type: LogLine["type"]) {
  if (type === "ok") return "var(--syn-str)";
  if (type === "err") return "var(--ide-err)";
  if (type === "warn") return "var(--ide-warn)";
  if (type === "dim") return "var(--ide-text-faint)";
  if (type === "prompt") return "var(--syn-fn)";
  return "var(--ide-text)";
}

function getEspIdfTargetForBoard(boardId: string | null | undefined): string | null {
  switch (boardId) {
    case "esp32":
      return "xtensa-esp32-espidf";
    case "esp32s2":
      return "xtensa-esp32s2-espidf";
    case "esp32s3":
      return "xtensa-esp32s3-espidf";
    case "esp32c3":
      return "riscv32imc-esp-espidf";
    case "esp32c6":
      return "riscv32imac-esp-espidf";
    default:
      return null;
  }
}

function resolveExpectedTarget(currentTarget: string, board: any): string {
  if (!board) return currentTarget;
  const espIdfTarget = getEspIdfTargetForBoard(board.id);
  if (espIdfTarget && currentTarget === espIdfTarget) return espIdfTarget;
  return board.target;
}

function getAcceptedTargetsForBoard(board: any): string[] {
  if (!board) return [];
  const targets = [board.target];
  const espIdfTarget = getEspIdfTargetForBoard(board.id);
  if (espIdfTarget && !targets.includes(espIdfTarget)) {
    targets.push(espIdfTarget);
  }
  return targets;
}

function tryNormalizeJsonInline(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return raw;
  }
}

function parseSerialLine(rawText: string): ParsedSerialLine {
  const levelMatch = rawText.match(/^([IWE])\s*\((\d+)\)\s*([^:]+):\s*(.*)$/);
  const level = levelMatch ? (levelMatch[1] as "I" | "W" | "E") : undefined;
  const tick = levelMatch ? levelMatch[2] : undefined;
  const tag = levelMatch ? levelMatch[3].trim() : undefined;
  const body = levelMatch ? levelMatch[4].trim() : rawText.trim();

  const mqttOut = body.match(/^📤\s*\[([^\]]+)\]\s*(\{.*\})\s*$/u);
  if (mqttOut) {
    return {
      structured: true,
      level,
      tick,
      tag,
      topic: mqttOut[1].trim(),
      payload: tryNormalizeJsonInline(mqttOut[2].trim()),
      body,
      raw: rawText,
    };
  }

  const mqttEvent = body.match(/^📨\s*Evento MQTT:\s*(.+)$/u);
  if (mqttEvent) {
    return {
      structured: true,
      level,
      tick,
      tag,
      body: mqttEvent[1].trim(),
      raw: rawText,
    };
  }

  if (levelMatch) {
    return { structured: true, level, tick, tag, body, raw: rawText };
  }

  return { structured: false, raw: rawText };
}

function splitFlashProgressEntries(text: string): string[] {
  const marker = /\[\d{2}:\d{2}:\d{2}\]\s+\[/g;
  const indices: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text)) !== null) {
    indices.push(match.index);
  }

  if (indices.length <= 1) return [text];

  const out: string[] = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : text.length;
    const part = text.slice(start, end).trim();
    if (part) out.push(part);
  }
  return out.length ? out : [text];
}

function parseFlashProgressLine(text: string): ParsedFlashProgress | null {
  const m = text.match(/^\[(\d{2}:\d{2}:\d{2})\]\s+\[[^\]]*\]\s+(\d+)\/(\d+)\s+(0x[0-9a-fA-F]+)\s+(.+)$/);
  if (!m) return null;
  const current = Number(m[2]);
  const total = Number(m[3]);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return null;
  const percent = Math.max(0, Math.min(100, (current / total) * 100));
  return {
    elapsed: m[1],
    current,
    total,
    address: m[4],
    status: m[5].trim(),
    percent,
  };
}

// ─── Main IDE Layout ─────────────────────────────────────────────────────────
export function IDELayout() {

  const [activeSidebar, setActiveSidebar] = useState<number | null>(0);
  const [activeBottomTab, setActiveBottomTab] = useState<BTab>("out");
  const [outputLines, setOutputLines] = useState<LogLine[]>([
    { text: "Rusteon IDE v0.1 — Ready", type: "dim" },
  ]);
  const [serialLines, setSerialLines] = useState<LogLine[]>([
    { text: "── Serial Monitor ──", type: "dim" },
  ]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(180);
  const [isDragging, setIsDragging] = useState(false);
  const [sideWidth, setSideWidth] = useState(350);
  const [isSideDragging, setIsSideDragging] = useState(false);
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.ide-menu-container')) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  // Serial Monitor UI state
  const [autoScrollSerial, setAutoScrollSerial] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(false);

  // Board selector state from Zustand
  const serialDialogOpen    = useIDEStore((state) => state.serialDialogOpen);
  const boardPortDialogOpen = useIDEStore((state) => state.boardPortDialogOpen);
  const setSerialDialogOpen    = useIDEStore((state) => state.setSerialDialogOpen);
  const setBoardPortDialogOpen = useIDEStore((state) => state.setBoardPortDialogOpen);
  const setSelectedPort = useIDEStore((state) => state.setSelectedPort);
  const selectedPort    = useIDEStore((state) => state.selectedPort);
  const selectedBoard   = useIDEStore((state) => state.selectedBoard);
  const setSelectedBoard = useIDEStore((state) => state.setSelectedBoard);
  const showAlert = useIDEStore((state) => state.showAlert);

  // Project state
  const activeProjectPath = useIDEStore((state) => state.activeProjectPath);
  const setActiveProject = useIDEStore((state) => state.setActiveProject);
  const setWizardOpen = useIDEStore((state) => state.setWizardOpen);
  const addLog = useIDEStore((state) => state.addLog);
  const openTabs = useIDEStore((state) => state.openTabs);
  const removeOpenTab = useIDEStore((state) => state.removeOpenTab);
  const activeFile = useIDEStore((state) => state.activeFile);
  const setActiveFile = useIDEStore((state) => state.setActiveFile);
  const setContent = useIDEStore((state) => state.setContent);
  const content = useIDEStore((state) => state.content);
  const setFeatureDiagnostics = useIDEStore((state) => state.setFeatureDiagnostics);
  const standardErrors = useIDEStore((state) => state.standardErrors);
  const setStandardErrors = useIDEStore((state) => state.setStandardErrors);
  const serialBaudRate = useIDEStore((state) => state.serialBaudRate);
  const setSerialBaudRate = useIDEStore((state) => state.setSerialBaudRate);
  const serialConnected = useIDEStore((state) => state.serialConnected);
  const setSerialConnected = useIDEStore((state) => state.setSerialConnected);
  const autoSaveEnabled = useIDEStore((state) => state.autoSaveEnabled);
  const setAutoSaveEnabled = useIDEStore((state) => state.setAutoSaveEnabled);
  const rustAnalyzerEnabled = useIDEStore((state) => state.rustAnalyzerEnabled);
  const setRustAnalyzerEnabled = useIDEStore((state) => state.setRustAnalyzerEnabled);

  // LSP State
  const lspLogs = useIDEStore((state) => state.lspLogs);
  const clearLspLogs = useIDEStore((state) => state.clearLspLogs);

  // Debug State
  const debugState = useDebugStore((state) => state.state);
  const setDebugState = useDebugStore((state) => state.setState);
  const setDebugError = useDebugStore((state) => state.setError);

  // Memory State
  const memoryActive = useMemoryStore((state) => state.active);

  const outputRef = useRef<HTMLDivElement>(null);
  const serialRef = useRef<HTMLDivElement>(null);
  const lspRefLocal = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const serialInputRef = useRef<HTMLInputElement>(null);

  const toggleSerialConnection = async () => {
    if (serialConnected) {
      try {
        await invoke("stop_serial");
        setSerialConnected(false);
        setSerialLines(prev => [...prev, { text: `[${new Date().toLocaleTimeString()}] Disconnected.`, type: "dim" }]);
      } catch (e) {
        addLog(`Error stopping serial: ${e}`);
      }
    } else {
      if (!selectedPort) {
        addLog("Please select a valid COM port first.");
        return;
      }
      try {
        const msg = await invoke<string>("start_serial", { portName: selectedPort, baudRate: serialBaudRate });
        setSerialConnected(true);
        setSerialLines(prev => [...prev, { text: `[${new Date().toLocaleTimeString()}] ${msg}`, type: "ok" }]);
      } catch (e) {
        addLog(`Serial error: ${e}`);
        setSerialLines(prev => [...prev, { text: `[${new Date().toLocaleTimeString()}] Connection failed: ${e}`, type: "err" }]);
      }
    }
  };

  const handleSendSerial = async () => {
     if (!serialInputRef.current) return;
     const val = serialInputRef.current.value;
     if (!val) return;
     if (!serialConnected) {
        addLog("Serial not connected.");
        return;
     }
     try {
       await invoke("send_serial", { data: val + "\r\n" });
       setSerialLines(prev => [...prev, { text: `[${new Date().toLocaleTimeString()}] -> ${val}`, type: "plain" }]);
       serialInputRef.current.value = "";
     } catch(e) {
       addLog(`Serial send error: ${e}`);
     }
  };

  // Dragging refs
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);


  // Handle port selection from SerialPortDialog — just close the dropdown, board port dialog has its own flow
  const handlePortSelected = (port: string) => {
    setSelectedPort(port);
    setSerialDialogOpen(false);
  };

  // Handle closing dialogs
  const handleCloseSerialDialog = () => {
    setSerialDialogOpen(false);
  };

  const handleConfirmBoardPort = (board: string, port: string | null) => {
    setSelectedBoard(board);
    if (port) setSelectedPort(port);
  };

  // ── Open a project folder and auto-load main.rs ──────────────────────────
  const openProject = async (projectPath: string, projectName: string) => {
    setActiveProject(projectPath, projectName);
    // Persist for next startup
    try {
      await invoke("save_last_project", { path: projectPath, name: projectName });
    } catch { /* non-critical */ }

    // Try to open src/main.rs automatically
    const mainPath = `${projectPath}/src/main.rs`;
    try {
      const text = await invoke<string>("read_file_content", { path: mainPath });
      setActiveFile(mainPath);
      setContent(text);
      // Add tab if not already open
      const store = useIDEStore.getState();
      if (!store.openTabs.some((t: any) => t.path === mainPath)) {
        store.addOpenTab({ path: mainPath, name: "main.rs" });
      }
    } catch {
      // No main.rs found — that's fine, just open the project
    }
  };

  const handleOpenFolder = async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Select your Rust Project Folder",
      });
      if (selected && typeof selected === "string") {
        const folderName = selected.split(/[/\\]/).pop() || "Project";
        await openProject(selected, folderName);
      }
    } catch (e) {
      addLog(`[Error] Dialog failed: ${e}`);
    }
  };

  // Restore last project on startup
  useEffect(() => {
    invoke<{ path: string; name: string } | null>("load_last_project").then((last) => {
      if (last && last.path) {
        openProject(last.path, last.name);
      }
    }).catch(() => { /* no saved project */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unlistenBuild = listen<any>("ide-build-log", (event) => {
      let type: LogLine["type"] = "plain";
      const txt = event.payload.line;
      if (txt.includes("error:") || txt.includes("error[")) type = "err";
      else if (txt.includes("warning:")) type = "warn";
      else if (txt.trim().startsWith("Compiling") || txt.trim().startsWith("Finished") || txt.trim().startsWith("Running")) type = "ok";
      
      setOutputLines(prev => {
        const next = [...prev, { text: txt, type }];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
    });
    const unlistenFlash = listen<any>("ide-flash-log", (event) => {
      setOutputLines(prev => {
        const next: LogLine[] = [...prev, { text: event.payload.line, type: "plain" as const }];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
    });
    const unlistenSerial = listen<any>("ide-serial-log", (event) => {
      const raw: string = event.payload.line;

      // ── Telemetry intercept ────────────────────────────────────────
      const snap = parseTelemetryLine(raw);
      if (snap) {
        useMemoryStore.getState().setSnapshot(snap);
        return; // swallow — don't show raw telemetry bytes in the console
      }

      const display = stripAnsi(raw);
      const now = new Date();
      const ts = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + now.getMilliseconds().toString().padStart(3, '0');
      setSerialLines(prev => {
        const next: LogLine[] = [...prev, { text: display, type: "plain" as const, timestamp: ts }];
        return next.length > 800 ? next.slice(next.length - 800) : next;
      });
    });

    const handleDapRtt = (e: any) => {
      const { text, type } = e.detail;
      const clean = typeof text === "string" ? stripAnsi(text) : text;
      const now = new Date();
      const ts = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + now.getMilliseconds().toString().padStart(3, '0');
      setSerialLines(prev => {
        const next: LogLine[] = [...prev, { text: clean, type: type || "plain", timestamp: ts }];
        return next.length > 800 ? next.slice(next.length - 800) : next;
      });
    };
    
    const handleGlobalLog = (e: any) => {
      const { text, type } = e.detail;
      setOutputLines(prev => {
        const next = [...prev, { text, type: type || "plain" }];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
      setActiveBottomTab("out");
    };

    window.addEventListener("dap-rtt-log", handleDapRtt);
    window.addEventListener("ide-global-log", handleGlobalLog);

    return () => {
      unlistenBuild.then(f => f());
      unlistenFlash.then(f => f());
      unlistenSerial.then(f => f());
      window.removeEventListener("dap-rtt-log", handleDapRtt);
      window.removeEventListener("ide-global-log", handleGlobalLog);
    };
  }, []);

  const cancelRef = useRef(false);

  const handleCancelProcess = async () => {
    if (cancelRef.current) return;
    cancelRef.current = true;
    setIsBuilding(false);
    setIsFlashing(false);
    setOutputLines(prev => [...prev, { text: "⏹ Cancellation requested...", type: "warn" }]);
    try {
      await invoke("cancel_process");
    } catch (e) {
      addLog(`Failed to cancel: ${e}`);
    }
  };

  const autoSaveActiveFile = async (): Promise<boolean> => {
    const getter = (window as any).__RUSTEON_EDITOR_GET_VALUE__ as
      | undefined
      | (() => { path: string | null; content: string });

    const latest = getter ? getter() : null;
    const pathToSave = latest?.path ?? activeFile;
    const contentToSave = latest?.content ?? content;

    if (!pathToSave) return true; // nothing to save
    try {
      await invoke("save_file", { path: pathToSave, content: contentToSave });
      setOutputLines(prev => [...prev, { text: `  💾 Auto-saved ${pathToSave.split(/[/\\]/).pop()}`, type: "dim" }]);
      return true;
    } catch (e) {
      setOutputLines(prev => [...prev, { text: `[Error] Auto-save failed: ${e}`, type: "err" }]);
      return false;
    }
  };

  const runDiagnosticsOnFailure = async () => {
    if (!activeProjectPath) return;
    try {
      const diags = await invoke<any>("check_project", { projectPath: activeProjectPath });
      if (diags) {
        if (diags.features && diags.features.length > 0) {
          setFeatureDiagnostics(diags.features);
          setOutputLines(prev => [...prev, { 
            text: `⚠ ${diags.features.length} missing features detected. Check the Library Manager -> Diagnostics tab to fix them.`, 
            type: "warn" 
          }]);
        } else {
          setFeatureDiagnostics([]);
        }

        if (diags.errors && diags.errors.length > 0) {
          setStandardErrors(diags.errors);
          setActiveBottomTab("errors");
        } else {
          setStandardErrors([]);
        }
      }
    } catch {
      // fail silently
    }
  };

  const handleBuild = async () => {
    if (!activeProjectPath) {
      addLog("No project opened for build.");
      return;
    }
    if (isBuilding || isFlashing) {
      await handleCancelProcess();
      return;
    }
    setIsBuilding(true);
    cancelRef.current = false;
    try {
      await invoke("reset_process_cancel");
    } catch {}
    setActiveBottomTab("out");
    setOutputLines([{ text: "> cargo build --release", type: "prompt" }]);
    
    try {
      // Always save before building so cargo compiles the latest code
      const saved = await autoSaveActiveFile();
      if (!saved) { setIsBuilding(false); return; }

      // Target Installation Check
      if (selectedBoardDef) {
        const state = await invoke<{ installed_targets: string[] }>("check_installed_targets");
        const currentTarget = await invoke<string>("get_project_target", { projectPath: activeProjectPath });
        const expectedTarget = resolveExpectedTarget(currentTarget, selectedBoardDef);
        const acceptedTargets = getAcceptedTargetsForBoard(selectedBoardDef);
        const hasAnyValidTarget = acceptedTargets.some(t => state.installed_targets.includes(t));
        if (!hasAnyValidTarget) {
          setOutputLines(prev => [...prev, { text: `[Error] No valid target found for ${selectedBoardDef.name}. Install one of: ${acceptedTargets.join(", ")}.`, type: "err" }]);
          setIsBuilding(false);
          return;
        }

        if (!acceptedTargets.includes(expectedTarget)) {
          setOutputLines(prev => [...prev, { text: `[Warning] Project target (${expectedTarget}) is unusual for ${selectedBoardDef.name}.`, type: "warn" }]);
        }
      }

      if (cancelRef.current) {
        throw new Error("Build cancelled");
      }

      const res = await invoke<string>("build_project", { projectPath: activeProjectPath });
      setOutputLines(prev => [...prev, { text: `✓ ${res}`, type: "ok" }]);
      setFeatureDiagnostics([]); // clear on success
    } catch (e) {
      if (cancelRef.current || String(e).toLowerCase().includes("cancel")) {
        setOutputLines(prev => [...prev, { text: "⏹ Build cancelled.", type: "warn" }]);
      } else {
        setOutputLines(prev => [...prev, { text: `[Error] ${e}`, type: "err" }]);
        await runDiagnosticsOnFailure();
      }
    } finally {
      cancelRef.current = false;
      setIsBuilding(false);
    }
  };

  const handleDebug = async () => {
    if (!activeProjectPath) {
      addLog("No project opened for debug.");
      return;
    }

    // ── Stop Session if already active ─────────────────────────
    if (debugState !== "idle" && debugState !== "stopped" && debugState !== "error") {
      try {
        await invoke("stop_debug_session");
        await DapClient.cleanup();
      } catch(e) {}
      useDebugStore.getState().reset();
      return;
    }

    setActiveBottomTab("out");
    setOutputLines([{ text: "> Starting Debug Session...", type: "prompt" }]);

    try {
      // ── Step 1: Check and auto-install probe-rs ─────────────
      const hasProbers = await invoke<boolean>("check_probers_installed");
      if (!hasProbers) {
        setOutputLines(prev => [...prev, { text: "⚙ probe-rs not found. Installing... (this may take a few minutes)", type: "dim" }]);
        setDebugState("building");
        await invoke("install_probers");
        setOutputLines(prev => [...prev, { text: "✓ probe-rs installed successfully!", type: "ok" }]);
      }

      // ── Step 2: Detect build target / hardware compatibility ─
      if (!selectedBoardDef) {
        setOutputLines(prev => [...prev, { text: "⚠ No board selected. Debug may fail.", type: "warn" }]);
      } else if (selectedBoardDef.arch === "xtensa") {
        showAlert("Hardware Debug Info", "Hardware Debug mode (Breakpoints) requires probe-rs, which ONLY supports ARM or RISC-V chips.\n\nFor the Classic ESP32 or Xtensa derivatives, please use Serial Debugging along with the Live Memory Dashboard.");
        setDebugState("idle");
        return;
      }

      let target = await invoke<string>("get_project_target", { projectPath: activeProjectPath });

      const expectedTarget = resolveExpectedTarget(target, selectedBoardDef);
      if (selectedBoardDef && target !== "unknown" && target !== expectedTarget) {
        const proceed = window.confirm(`Inconsistência de Placa detectada!\n\nVocê selecionou '${selectedBoardDef.name}', mas o projeto está configurado para '${target}'.\n\nDeseja alterar as configurações do projeto para iniciar a depuração corretamente na placa selecionada?`);
        if (proceed) {
          setOutputLines(prev => [...prev, { text: `> Sincronizando alvo para: ${expectedTarget}...`, type: "dim" }]);
          try {
            await invoke("update_cargo_target", { projectPath: activeProjectPath, newTarget: expectedTarget });
            target = expectedTarget;
            setOutputLines(prev => [...prev, { text: `✓ Configurações do projeto sincronizadas.`, type: "ok" }]);
          } catch (err: any) {
            setOutputLines(prev => [...prev, { text: `[Warning] Failed to update config.toml: ${err}`, type: "warn" }]);
          }
        }
      }

      setOutputLines(prev => [...prev, { text: `ℹ Target: ${target} | Chip: ${selectedBoardDef?.chip || "unknown"}`, type: "dim" }]);

      // ── Step 3: Build ELF ────────────────────────────────────
      setDebugState("building");
      setOutputLines(prev => [...prev, { text: "> cargo build --message-format=json", type: "prompt" }]);

      const saved = await autoSaveActiveFile();
      if (!saved) { setDebugState("idle"); return; }

      const elfPath = await invoke<string>("build_for_debug", { projectPath: activeProjectPath });
      setOutputLines(prev => [...prev, { text: `✓ Build success → ${elfPath.split("/").pop()}`, type: "ok" }]);

      // ── Step 4: Launch DAP Server ────────────────────────────
      setDebugState("launching");
      const port = await invoke<number>("start_debug_session", { projectPath: activeProjectPath });
      useDebugStore.getState().setPort(port);
      setOutputLines(prev => [...prev, { text: `✓ probe-rs dap-server listening on port ${port}`, type: "ok" }]);

      // ── Step 5: Connect DAP client ───────────────────────────
      const chipName = selectedBoardDef ? selectedBoardDef.chip.toLowerCase() : "esp32c3";
      await DapClient.init();
      await DapClient.initialize();
      await DapClient.launch(elfPath, chipName);

    } catch (e: any) {
      setOutputLines(prev => [...prev, { text: `[Debug Error] ${e}`, type: "err" }]);
      setDebugError(e.toString());
      useDebugStore.getState().reset();
    }
  };


  const handleFlash = async () => {
    if (!activeProjectPath) {
      addLog("No project opened for flash.");
      return;
    }
    if (isBuilding || isFlashing) {
      await handleCancelProcess();
      return;
    }
    setIsFlashing(true);
    cancelRef.current = false;
    try {
      await invoke("reset_process_cancel");
    } catch {}
    setActiveBottomTab("out");
    
    setOutputLines([{ text: "> Upload starting...", type: "prompt" }]);
    try {
      // 0. Free the serial port so espflash can connect
      if (serialConnected) {
        await invoke("stop_serial");
        setSerialConnected(false);
        setOutputLines(prev => [...prev, { text: "  📡 Serial disconnected to free port for flashing.", type: "dim" }]);
      }

      if (cancelRef.current) throw new Error("Build cancelled");

      // 1. Auto-save before any compilation
      const saved = await autoSaveActiveFile();
      if (!saved) { setIsFlashing(false); return; }

      if (cancelRef.current) throw new Error("Build cancelled");

      // 1.1 Target Installation Check
      if (selectedBoardDef) {
        const state = await invoke<{ installed_targets: string[] }>("check_installed_targets");
        const currentTarget = await invoke<string>("get_project_target", { projectPath: activeProjectPath });
        const expectedTarget = resolveExpectedTarget(currentTarget, selectedBoardDef);
        const acceptedTargets = getAcceptedTargetsForBoard(selectedBoardDef);
        const hasAnyValidTarget = acceptedTargets.some(t => state.installed_targets.includes(t));
        if (!hasAnyValidTarget) {
          setOutputLines(prev => [...prev, { text: `[Error] No valid target found for ${selectedBoardDef.name}. Install one of: ${acceptedTargets.join(", ")}.`, type: "err" }]);
          setIsFlashing(false);
          return;
        }

        if (!acceptedTargets.includes(expectedTarget)) {
          setOutputLines(prev => [...prev, { text: `[Warning] Project target (${expectedTarget}) is unusual for ${selectedBoardDef.name}.`, type: "warn" }]);
        }
      }

      if (cancelRef.current) throw new Error("Build cancelled");

      // 1.5. Target Sync Check
      if (selectedBoardDef) {
        const currentTarget = await invoke<string>("get_project_target", { projectPath: activeProjectPath });
        const expectedTarget = resolveExpectedTarget(currentTarget, selectedBoardDef);
        if (currentTarget !== "unknown" && currentTarget !== expectedTarget) {
          const proceed = window.confirm(`Inconsistência de Placa detectada!\n\nVocê selecionou '${selectedBoardDef.name}' na Interface, mas o projeto está configurado internamente para compilar para '${currentTarget}'.\n\nDeseja alterar as configurações do projeto (.cargo/config.toml) para garantir que a compilação funcione na placa que você selecionou?`);
          
          if (proceed) {
            setOutputLines(prev => [...prev, { text: `> Sincronizando alvo para: ${expectedTarget} (${selectedBoardDef.chip})...`, type: "dim" }]);
            try {
              await invoke("update_cargo_target", { projectPath: activeProjectPath, newTarget: expectedTarget });
              setOutputLines(prev => [...prev, { text: `✓ Configurações do projeto sincronizadas.`, type: "ok" }]);
            } catch (err: any) {
              setOutputLines(prev => [...prev, { text: `[Warning] Failed to update config.toml: ${err}`, type: "warn" }]);
            }
          }
        }
      }

      if (cancelRef.current) throw new Error("Build cancelled");

      // 2. Build
      setOutputLines(prev => [...prev, { text: "> cargo build --release", type: "prompt" }]);
      await invoke<string>("build_project", { projectPath: activeProjectPath });
      
      if (cancelRef.current) throw new Error("Build cancelled");

      // 3. Flash
      setOutputLines(prev => [...prev, { text: "> Flashing...", type: "prompt" }]);
      if (cancelRef.current) throw new Error("Build cancelled");
      const res = await invoke<string>("flash_firmware", {
        projectPath: activeProjectPath,
        flashTool: selectedBoardDef?.flashTool || "espflash",
        port: selectedPort === "Auto" ? null : selectedPort
      });

      if (cancelRef.current) throw new Error("Flash cancelled");

      setOutputLines(prev => [...prev, { text: `✓ ${res}`, type: "ok" }]);
      setFeatureDiagnostics([]); // clear on success

      // 4. Auto-switch to Serial Monitor and connect
      if (selectedPort && !serialConnected) {
        setOutputLines(prev => [...prev, {
          text: `  📡 Opening Serial Monitor on ${selectedPort} (${serialBaudRate} baud)...`,
          type: "dim"
        }]);
        setActiveBottomTab("serial");
        try {
          const msg = await invoke<string>("start_serial", {
            portName: selectedPort,
            baudRate: serialBaudRate
          });
          setSerialConnected(true);
          setSerialLines(prev => [...prev, { text: `[${new Date().toLocaleTimeString()}] ${msg}`, type: "ok" }]);
        } catch (e) {
          setSerialLines(prev => [...prev, { text: `[${new Date().toLocaleTimeString()}] Serial auto-connect failed: ${e}`, type: "err" }]);
        }
      }
    } catch (e) {
      if (cancelRef.current || String(e).toLowerCase().includes("cancel")) {
        setOutputLines(prev => [...prev, { text: "⏹ Upload cancelled.", type: "warn" }]);
      } else {
        setOutputLines(prev => [...prev, { text: `[Error] Deploy failed: ${e}`, type: "err" }]);
        await runDiagnosticsOnFailure();
      }
    } finally {
      cancelRef.current = false;
      setIsBuilding(false);
      setIsFlashing(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        handleDebug();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDebug]);

  const handleSaveFile = async () => {
    const getter = (window as any).__RUSTEON_EDITOR_GET_VALUE__ as
      | undefined
      | (() => { path: string | null; content: string });

    const latest = getter ? getter() : null;
    const pathToSave = latest?.path ?? activeFile;
    const contentToSave = latest?.content ?? content;

    if (pathToSave) {
      try {
        await invoke("save_file", { path: pathToSave, content: contentToSave });
        addLog(`✓ Saved ${pathToSave.split(/[/\\]/).pop()}`);
      } catch (e) {
        addLog(`[Error] Failed to save file: ${e}`);
      }
    }
  };

  const handleSerial = () => {
    setActiveBottomTab("serial");
    toggleSerialConnection();
  };

  // Auto-scroll console
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [outputLines]);
  useEffect(() => {
    if (autoScrollSerial && serialRef.current) {
      serialRef.current.scrollTop = serialRef.current.scrollHeight;
    }
  }, [serialLines, autoScrollSerial]);
  useEffect(() => {
    if (lspRefLocal.current) {
      lspRefLocal.current.scrollTop = lspRefLocal.current.scrollHeight;
    }
  }, [lspLogs]);
  // ── Resizable bottom panel drag ──────────────────────────────────────────
  const onDragMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartH.current = bottomHeight;
    setIsDragging(true);
  };

  const rafRef = useRef<number | null>(null);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const delta = dragStartY.current - e.clientY;
      const newH = Math.min(600, Math.max(80, dragStartH.current + delta));
      setBottomHeight(newH);
    });
  }, [isDragging]);

  const onMouseUp = useCallback(() => setIsDragging(false), []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging, onMouseMove, onMouseUp]);

  // ── Resizable side panel drag ──────────────────────────────────────────
  const onSideDragMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartW.current = sideWidth;
    setIsSideDragging(true);
  };

  const sideRafRef = useRef<number | null>(null);

  const onSideMouseMove = useCallback((e: MouseEvent) => {
    if (!isSideDragging) return;
    if (sideRafRef.current) cancelAnimationFrame(sideRafRef.current);
    sideRafRef.current = requestAnimationFrame(() => {
      const delta = e.clientX - dragStartX.current;
      const newW = Math.min(800, Math.max(150, dragStartW.current + delta));
      setSideWidth(newW);
    });
  }, [isSideDragging]);

  const onSideMouseUp = useCallback(() => setIsSideDragging(false), []);

  useEffect(() => {
    if (isSideDragging) {
      window.addEventListener("mousemove", onSideMouseMove);
      window.addEventListener("mouseup", onSideMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", onSideMouseMove);
      window.removeEventListener("mouseup", onSideMouseUp);
    };
  }, [isSideDragging, onSideMouseMove, onSideMouseUp]);

  const MENU_STRUCTURE: Record<string, any[]> = {
    "File": [
      { label: "New Project...", action: () => { setWizardOpen(true); setOpenMenu(null); }, icon: <NoteAddIcon fontSize="small"/> },
      { label: "Open Project...", action: () => { handleOpenFolder(); setOpenMenu(null); }, icon: <FolderOpenIcon fontSize="small"/> },
      { label: "Save", action: () => { handleSaveFile(); setOpenMenu(null); }, icon: <SaveIcon fontSize="small"/>, shortcut: "Ctrl+S" },
      { label: "Auto Save", action: () => setAutoSaveEnabled(!autoSaveEnabled), isCheckbox: true, checked: autoSaveEnabled },
      { label: "Rust Analyzer", action: () => setRustAnalyzerEnabled(!rustAnalyzerEnabled), isCheckbox: true, checked: rustAnalyzerEnabled },
      { divider: true },
      { label: "Exit", action: () => getCurrentWindow().close() }
    ],
    "Edit": [
      { label: "Undo", action: () => { document.execCommand('undo'); setOpenMenu(null); }, shortcut: "Ctrl+Z" },
      { label: "Redo", action: () => { document.execCommand('redo'); setOpenMenu(null); }, shortcut: "Ctrl+Y" },
      { divider: true },
      { label: "Cut", action: () => { document.execCommand('cut'); setOpenMenu(null); }, shortcut: "Ctrl+X" },
      { label: "Copy", action: () => { document.execCommand('copy'); setOpenMenu(null); }, shortcut: "Ctrl+C" },
      { label: "Paste", action: () => { document.execCommand('paste'); setOpenMenu(null); }, shortcut: "Ctrl+V" },
    ],
    "Sketch": [
      { label: "Verify / Compile", action: () => { handleBuild(); setOpenMenu(null); }, icon: <CheckIcon fontSize="small"/>, shortcut: "Ctrl+R" },
      { label: "Upload", action: () => { handleFlash(); setOpenMenu(null); }, icon: <FileUploadIcon fontSize="small"/>, shortcut: "Ctrl+U" },
      { divider: true },
      { label: "Cancel Process", action: () => { handleCancelProcess(); setOpenMenu(null); }, icon: <StopIcon fontSize="small"/> },
      { divider: true },
      { label: "Start Debugging", action: () => { handleDebug(); setOpenMenu(null); }, icon: <BugReportIcon fontSize="small"/>, shortcut: "F5" },
    ],
    "Tools": [
      { label: "Board Manager...", action: () => { setBoardPortDialogOpen(true); setOpenMenu(null); }, icon: <DeveloperBoardIcon fontSize="small"/> },
      { label: "Library Manager...", action: () => { setActiveSidebar(2); setOpenMenu(null); }, icon: <ExtensionIcon fontSize="small"/> },
      { divider: true },
      { label: "Serial Monitor", action: () => { handleSerial(); setOpenMenu(null); }, icon: <UsbIcon fontSize="small"/> },
      { label: "Live Memory Dashboard", action: () => { setMemoryModalOpen(true); setOpenMenu(null); }, icon: <MemoryIcon fontSize="small"/> },
    ],
    "Help": [
      { label: "About Rusteon", action: () => { showAlert("About Rusteon", "Rusteon IDE v0.1\n\nA Modern Embedded Rust Development Environment."); setOpenMenu(null); } }
    ]
  };

  const sidebarLabel = ["Explorer", "Boards", "Libraries", "Examples", "Search", "Settings"];
  
  const selectedBoardDef = BOARDS.find((b) => b.id === selectedBoard);

  return (
    <div className="ide-root">

      {/* ── MENU BAR ──────────────────────────────────────────────────── */}
      <div className="ide-menubar ide-menu-container">
        {["File", "Edit", "Sketch", "Tools", "Help"].map((item) => (
          <div key={item} style={{ position: 'relative' }}>
            <span 
              className={`ide-menu-item ${openMenu === item ? 'ide-menu-item--active' : ''}`}
              onClick={() => setOpenMenu(openMenu === item ? null : item)}
              onMouseEnter={() => {
                if (openMenu && openMenu !== item) setOpenMenu(item);
              }}
            >
              {item}
            </span>
            {openMenu === item && (
              <div className="ide-menu-dropdown">
                {MENU_STRUCTURE[item].map((menuItem, idx) => 
                  menuItem.divider ? (
                    <div key={idx} className="ide-menu-dropdown-divider" />
                  ) : (
                    <button key={idx} className="ide-menu-dropdown-item" onClick={menuItem.action}>
                      <span className="ide-menu-dropdown-icon">
                        {menuItem.isCheckbox ? (
                          <span
                            className={`ide-menu-checkbox ${menuItem.checked ? "ide-menu-checkbox--checked" : ""}`}
                            aria-hidden="true"
                          >
                            {menuItem.checked && <CheckIcon sx={{ fontSize: 13 }} />}
                          </span>
                        ) : (
                          menuItem.icon
                        )}
                      </span>
                      {menuItem.label}
                      {menuItem.shortcut && <span className="ide-menu-dropdown-shortcut">{menuItem.shortcut}</span>}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
        <span className="ide-menu-spacer" />
        <span className="ide-menu-badge">Rusteon IDE v0.1</span>
      </div>

      {/* ── TOOLBAR ───────────────────────────────────────────────────── */}
      <div className="ide-toolbar">
        <div className="ide-toolbar-actions">
          <button
            id="btn-build"
            className={`tool-btn tool-btn--primary ${isBuilding || debugState === "building" ? "tool-btn--busy" : ""}`}
            onClick={handleBuild}
            title={isBuilding ? "Cancel Build" : "Verify / Build (Ctrl+R)"}
          >
            {isBuilding || debugState === "building"
              ? <CloseIcon sx={{ fontSize: 22, color: '#fff' }} />
              : <CheckIcon sx={{ fontSize: 22, color: '#fff' }} />}
          </button>

          <button
            id="btn-upload"
            className={`tool-btn tool-btn--primary ${isFlashing || debugState === "launching" ? "tool-btn--busy" : ""}`}
            onClick={handleFlash}
            title={isFlashing ? "Cancel Upload" : "Upload / Flash (Ctrl+U)"}
          >
            {isFlashing || debugState === "launching"
              ? <CloseIcon sx={{ fontSize: 22, color: '#fff' }} />
              : <FileUploadIcon sx={{ fontSize: 22, color: '#fff' }} />}
          </button>

          <div className="tool-btn-divider" />

          <button 
            id="btn-debug" 
            className={`tool-btn ${debugState === 'running' || debugState === 'paused' ? 'tool-btn--busy' : 'tool-btn--ghost'}`} 
            title="Start Debugging (F5)"
            onClick={handleDebug}
          >
            {(debugState === "building" || debugState === "launching")
              ? <RefreshIcon className="spin-icon" sx={{ fontSize: 22 }} />
              : (debugState === "running" || debugState === "paused") 
              ? <StopIcon sx={{ fontSize: 22, color: "#fff" }} />
              : <BugReportIcon sx={{ fontSize: 22 }} />
            }
          </button>
          <button id="btn-new" className="tool-btn tool-btn--ghost" title="New Project" onClick={() => setWizardOpen(true)}>
            <NoteAddIcon sx={{ fontSize: 22 }} />
          </button>
          <button id="btn-open" className="tool-btn tool-btn--ghost" title="Open Project" onClick={handleOpenFolder}>
            <FolderIcon sx={{ fontSize: 22 }} />
          </button>
          <button id="btn-save" className="tool-btn tool-btn--ghost" title="Save (Ctrl+S)" onClick={handleSaveFile}>
            <SaveIcon sx={{ fontSize: 22 }} />
          </button>

          <div className="tool-btn-divider" />

          <button
            id="btn-memory"
            className={`tool-btn tool-btn--ghost ${memoryModalOpen ? "tool-btn--active" : ""}`}
            title="Live Memory Dashboard"
            onClick={() => setMemoryModalOpen(true)}
          >
            <MemoryIcon sx={{ fontSize: 22 }} />
            {memoryActive && <div className="tool-btn-badge" />}
          </button>
        </div>

        {/* Board Selector Button with Dropdowns */}
        <div style={{ position: 'relative', marginLeft: '8px' }}>
          <BoardSelectorButton activeBoard={selectedBoardDef ? selectedBoardDef.name : "Select Board"} />
          
          {/* Serial port quick-select dropdown */}
          <SerialPortDialog
            open={serialDialogOpen}
            onClose={handleCloseSerialDialog}
            onPortSelected={handlePortSelected}
            onOpenBoardPortDialog={() => {
              setSerialDialogOpen(false);
              setBoardPortDialogOpen(true);
            }}
          />
        </div>


        {/* Serial Monitor button */}
        <button
          id="btn-serial"
          title={serialConnected ? "Disconnect Serial" : "Open Serial Monitor"}
          onClick={handleSerial}
          className={`tool-btn tool-btn--ghost tool-btn--serial ${serialConnected ? "tool-btn--active" : ""}`}
        >
          <UsbIcon sx={{ fontSize: 22 }} />
          <span className="tool-btn-label" style={{ fontSize: '11.5px' }}>{serialConnected ? "Serial ●" : "Serial"}</span>
        </button>
      </div>

      <DebugToolbar />

      {/* ── IDE Main Area ─────────────────────────────────────────────────── */}
      <div className={`ide-tabbar ${openTabs.length === 0 ? "ide-tabbar--hidden" : ""}`}>
        {openTabs.map((tab) => (
          <div
            key={tab.path}
            id={`tab-${tab.path}`}
            onClick={async () => {
              setActiveFile(tab.path);
              try {
                const text = await invoke<string>("read_file_content", { path: tab.path });
                setContent(text);
              } catch (e) {
                console.error("Failed to read tab content", e);
              }
            }}
            className={`ide-tab ${activeFile === tab.path ? "ide-tab--active" : ""}`}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            {(() => {
              const iconInfo = getFileIcon(tab.name, false, false);
              const isRust = tab.name.toLowerCase().endsWith(".rs");
              return (
                <span style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  fontSize: isRust ? "18px" : "15px", 
                  color: iconInfo.color 
                }}>
                  {iconInfo.icon}
                </span>
              );
            })()}
            {tab.name}
            <div 
              className="ide-tab-close" 
              onClick={(e) => { 
                e.stopPropagation(); 
                removeOpenTab(tab.path); 
              }}
              style={{ display: 'flex', alignItems: 'center', marginLeft: '4px', opacity: 0.5, borderRadius: '3px' }}
            >
              <CloseOutlinedIcon sx={{ fontSize: 12 }} />
            </div>
          </div>
        ))}
      </div>

      {/* ── BODY ──────────────────────────────────────────────────────── */}
      <div ref={bodyRef} className="ide-body">

        {/* Icon Sidebar */}
        <div className="ide-icon-sidebar">
          {[
            { icon: <FolderOpenIcon sx={{ fontSize: 29 }} />, label: "Explorer" },
            { icon: <DeveloperBoardIcon sx={{ fontSize: 29 }} />, label: "Boards" },
            { icon: <ExtensionIcon sx={{ fontSize: 29 }} />, label: "Libraries" },
            { icon: <BoltIcon sx={{ fontSize: 29 }} />, label: "Examples" },
            { icon: <SearchIcon sx={{ fontSize: 29 }} />, label: "Search" },
          ].map(({ icon }, idx) => (
            <button
              key={idx}
              id={`sidebar-btn-${idx}`}
              className={`icon-sidebar-btn ${activeSidebar === idx ? "icon-sidebar-btn--active" : ""}`}
              onClick={() => setActiveSidebar(prev => prev === idx ? null : idx)}
              title={sidebarLabel[idx]}
            >
              {icon}
            </button>
          ))}
          <div className="icon-sidebar-spacer" />
          <button
            id="sidebar-btn-settings"
            className={`icon-sidebar-btn ${activeSidebar === 5 ? "icon-sidebar-btn--active" : ""}`}
            onClick={() => setActiveSidebar(prev => prev === 5 ? null : 5)}
            title="Settings"
          >
            <SettingsIcon sx={{ fontSize: 29 }} />
          </button>
        </div>

        {/* Side Panel */}
        {activeSidebar !== null && (
          <>
            <div className="ide-side-panel" style={{ width: sideWidth }}>
              <div className="side-panel-header">
                {sidebarLabel[activeSidebar] || "Explorer"}
              </div>
              {activeSidebar === 0 ? (
                <ProjectExplorer />
              ) : activeSidebar === 1 ? (
                <BoardManager />
              ) : activeSidebar === 2 ? (
                activeProjectPath ? (
                  <LibraryManager />
                ) : (
                  <div className="side-panel-empty" style={{ padding: '0 20px', textAlign: 'center' }}>
                    <div className="side-panel-empty-icon" style={{ marginBottom: '16px', opacity: 0.5 }}>
                      <FolderOpenIcon sx={{ fontSize: 40 }} />
                    </div>
                    <p className="side-panel-empty-text" style={{ fontSize: '13px', color: '#cdd6f4', marginBottom: '8px' }}>
                      No project opened
                    </p>
                    <p className="side-panel-empty-sub" style={{ fontSize: '12px', color: '#888', lineHeight: 1.5 }}>
                      You need to open or create a Rust project to use the Library Manager.
                    </p>
                    <button
                      className="ide-tab-add"
                      style={{ marginTop: '20px', padding: '6px 16px', borderRadius: '4px', backgroundColor: 'var(--ide-accent)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600 }}
                      onClick={handleOpenFolder}
                    >
                      Open Project
                    </button>
                  </div>
                )
              ) : (
                <div className="side-panel-empty">
                  <div className="side-panel-empty-icon">
                    {activeSidebar === 3 && <BoltIcon sx={{ fontSize: 29 }} />}
                    {activeSidebar === 4 && <SearchIcon sx={{ fontSize: 29 }} />}
                    {activeSidebar === 5 && <SettingsIcon sx={{ fontSize: 29 }} />}
                  </div>
                  <p className="side-panel-empty-text">{sidebarLabel[activeSidebar]}</p>
                  <p className="side-panel-empty-sub">Coming soon</p>
                </div>
              )}
            </div>
            {/* Side Resize Handle */}
            <div
              className={`side-resize-handle ${isSideDragging ? "side-resize-handle--dragging" : ""}`}
              onMouseDown={onSideDragMouseDown}
              title="Drag to resize"
            />
          </>
        )}

        {/* Editor + Console column */}
        <div className="ide-editor-col">

          {/* Editor */}
          <div className="ide-editor-wrap">
            <Editor />
          </div>

          {/* Resize Handle */}
          <div
            className={`resize-handle ${isDragging ? "resize-handle--dragging" : ""}`}
            onMouseDown={onDragMouseDown}
            title="Drag to resize"
          >
            <div className="resize-handle-bar" />
          </div>


          {/* Bottom Panel */}
          <div className="ide-bottom-panel" style={{ height: bottomHeight }}>
            {/* Bottom Tabs */}
            <div className="ide-bottom-tabs">
              {(["out", "serial", "errors", "lsp"] as BTab[]).map((tab) => {
                const tabLabelMap: Record<string, string> = { out: "Output", serial: "Serial Monitor", errors: "Errors", lsp: "LSP Debug" };
                const isActive = activeBottomTab === tab;
                return (
                  <button
                    key={tab}
                    id={`btab-${tab}`}
                    onClick={() => setActiveBottomTab(tab)}
                    className={`bottom-tab ${isActive ? "bottom-tab--active" : ""}`}
                  >
                    {tabLabelMap[tab]}
                    {tab === "errors" && standardErrors.length > 0 && (
                      <span className="bottom-tab-badge bottom-tab-badge--err">{standardErrors.length}</span>
                    )}
                    {tab === "serial" && serialConnected && <span className="bottom-tab-indicator" />}
                  </button>
                );
              })}
              <div className="ide-bottom-tabs-spacer" />

            </div>

            {/* Output Tab */}
            {activeBottomTab === "out" && (
              <div ref={outputRef} className="console-output">
                {outputLines.map((line, i) => (
                  <div key={i} className="console-line" style={{ color: logColor(line.type) }}>
                    {(() => {
                      const parts = splitFlashProgressEntries(line.text);
                      if (parts.length === 1) {
                        const parsed = parseFlashProgressLine(parts[0]);
                        if (!parsed) return line.text;
                        return (
                          <div className="console-progress-line">
                            <div className="console-progress-meta">
                              <span>[{parsed.elapsed}]</span>
                              <span>{parsed.current}/{parsed.total}</span>
                              <span>{parsed.address}</span>
                              <span>{parsed.status}</span>
                            </div>
                            <div className="console-progress-track">
                              <div className="console-progress-fill" style={{ width: `${parsed.percent}%` }} />
                            </div>
                          </div>
                        );
                      }

                      const parsedEntries = parts.map(parseFlashProgressLine);
                      if (parsedEntries.some((p) => !p)) return line.text;

                      return (
                        <div className="console-progress-group">
                          {parsedEntries.map((p, idx2) => (
                            <div key={idx2} className="console-progress-line">
                              <div className="console-progress-meta">
                                <span>[{p!.elapsed}]</span>
                                <span>{p!.current}/{p!.total}</span>
                                <span>{p!.address}</span>
                                <span>{p!.status}</span>
                              </div>
                              <div className="console-progress-track">
                                <div className="console-progress-fill" style={{ width: `${p!.percent}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                ))}
                <div className="console-line">
                  <span style={{ color: "var(--syn-fn)" }}>&gt;</span>{" "}
                  <span className="t-blink" />
                </div>
              </div>
            )}

            {/* Serial Tab */}
            {activeBottomTab === "serial" && (
              <div className="serial-panel">
                {/* Toolbar */}
                <div className="serial-toolbar">
                  <div className="serial-toolbar-left">
                    <div className={`serial-status-dot ${serialConnected ? "serial-status-dot--on" : ""}`} />
                    <SettingsEthernetIcon sx={{ fontSize: 14, color: selectedPort ? '#888' : '#444' }} />
                    <span className="serial-label">
                      {serialConnected
                        ? `Connected · ${serialBaudRate} baud`
                        : selectedPort
                        ? `${selectedPort} · Disconnected`
                        : "No port selected"}
                    </span>
                  </div>
                  <div className="serial-toolbar-right">
                    <button
                      className={`serial-icon-btn ${autoScrollSerial ? "serial-icon-btn--active" : ""}`}
                      onClick={() => setAutoScrollSerial(!autoScrollSerial)}
                      title="Auto-scroll"
                    >
                      <KeyboardDoubleArrowDownIcon sx={{ fontSize: 16 }} />
                    </button>
                    <button
                      className={`serial-icon-btn ${showTimestamps ? "serial-icon-btn--active" : ""}`}
                      onClick={() => setShowTimestamps(!showTimestamps)}
                      title="Show Timestamps"
                    >
                      <AccessTimeIcon sx={{ fontSize: 16 }} />
                    </button>
                    <button
                      className="serial-icon-btn"
                      onClick={() => setSerialLines([{ text: "── Serial Monitor ──", type: "dim" }])}
                      title="Clear Output"
                    >
                      <DeleteOutlinedIcon sx={{ fontSize: 16 }} />
                    </button>
                    <button
                      className="serial-icon-btn"
                      onClick={() => {
                        const text = serialLines.map(l => showTimestamps && l.timestamp ? `[${l.timestamp}] ${l.text}` : l.text).join('\n');
                        navigator.clipboard.writeText(text);
                      }}
                      title="Copy All"
                    >
                      <ContentCopyIcon sx={{ fontSize: 14 }} />
                    </button>

                    <div style={{ width: 1, height: 16, background: '#2a2f3a', margin: '0 4px' }} />

                    <div className="serial-baud-wrapper">
                      <select
                        className="serial-select"
                        value={serialBaudRate}
                        onChange={(e) => setSerialBaudRate(Number(e.target.value))}
                        disabled={serialConnected}
                      >
                        <option value={9600}>9600 baud</option>
                        <option value={19200}>19200 baud</option>
                        <option value={38400}>38400 baud</option>
                        <option value={57600}>57600 baud</option>
                        <option value={115200}>115200 baud</option>
                      </select>
                      <KeyboardArrowDownIcon className="serial-chevron" sx={{ fontSize: 16 }} />
                    </div>
                    <button
                      className={`serial-connect-btn ${serialConnected ? "serial-connect-btn--disconnect" : "serial-connect-btn--connect"}`}
                      onClick={toggleSerialConnection}
                    >
                      {serialConnected ? (
                        <><StopIcon sx={{ fontSize: 14 }} /> Disconnect</>
                      ) : (
                        <><PlayArrowIcon sx={{ fontSize: 14 }} /> Connect</>
                      )}
                    </button>
                  </div>
                </div>

                {/* Output */}
                <div ref={serialRef} className="serial-output">
                  {serialLines.map((line, i) => (
                    <div key={i} className="serial-line">
                      {showTimestamps && line.timestamp && (
                        <span className="serial-line-timestamp">[{line.timestamp}] </span>
                      )}
                      {(() => {
                        if (line.type !== "plain") {
                          return <span className={`serial-line-text serial-line-text--${line.type}`}>{line.text}</span>;
                        }

                        const parsed = parseSerialLine(line.text);
                        if (parsed.structured) {
                          return (
                            <span className="serial-line-rich serial-line-rich--plain">
                              {(parsed.level || parsed.tick || parsed.tag) && (
                                <span className="serial-meta">
                                  {parsed.level && <span>{parsed.level}</span>}
                                  {parsed.tick && <span>({parsed.tick})</span>}
                                  {parsed.tag && <span>{parsed.tag}</span>}
                                </span>
                              )}
                              {parsed.topic ? (
                                <>
                                  <span className="serial-topic">[{parsed.topic}]</span>
                                  {parsed.payload && <span className="serial-json">{parsed.payload}</span>}
                                </>
                              ) : (
                                <span className="serial-line-text serial-line-text--plain">{parsed.body}</span>
                              )}
                            </span>
                          );
                        }

                        return <span className="serial-line-text serial-line-text--plain">{line.text}</span>;
                      })()}
                    </div>
                  ))}
                </div>

                {/* Input */}
                <div className={`serial-input-bar ${!serialConnected ? "serial-input-bar--disabled" : ""}`}>
                  <span className="serial-input-prompt">&gt;</span>
                  <input
                    ref={serialInputRef}
                    type="text"
                    className="serial-input"
                    placeholder={serialConnected ? "Send message... (Enter to submit)" : "Connect to send data"}
                    disabled={!serialConnected}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSendSerial(); }}
                  />
                  <button
                    className="serial-send-btn"
                    onClick={handleSendSerial}
                    disabled={!serialConnected}
                    style={{ display: "flex", alignItems: "center", gap: "6px" }}
                  >
                    <SendOutlinedIcon sx={{ fontSize: 14 }} />
                    <span>Send</span>
                  </button>
                </div>
              </div>
            )}

            {/* Errors Tab */}
            {activeBottomTab === "errors" && (
              <div className="errors-panel">
                {standardErrors.length === 0 ? (
                  <div className="errors-empty">
                    <span className="errors-empty-icon">✓</span>
                    <span>No errors or warnings found</span>
                  </div>
                ) : (
                  standardErrors.map((err, i) => (
                    <div key={i} className={`error-item error-item--${err.level}`}>
                      <span className="error-item-badge">
                        {err.level === "warning" ? "⚠" : "✕"}
                      </span>
                      <div className="error-item-body">
                        <span className="error-item-location">{err.file}:{err.line}{err.column ? `:${err.column}` : ""}</span>
                        <span className="error-item-message">{err.message}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ── LSP DEBUG TAB ── */}
            {activeBottomTab === "lsp" && (
              <div className="ide-output-console lsp-console" style={{ position: "relative", display: "flex", flexDirection: "column" }}>
                 <div className="serial-toolbar" style={{ position: "absolute", top: 0, right: 0, zIndex: 10, background: "var(--ide-bg)", padding: "4px" }}>
                   <button className="serial-icon-btn" onClick={clearLspLogs} title="Clear LSP Logs">
                     <DeleteOutlinedIcon sx={{ fontSize: 16 }} />
                   </button>
                 </div>
                 <div style={{ flex: 1, overflowY: "auto", padding: "30px 10px 10px", fontSize: "11px", fontFamily: "monospace" }} ref={lspRefLocal}>
                   {lspLogs.map((log, i) => (
                     <div key={i} style={{ 
                       color: log.dir === 'err' ? 'var(--ide-err)' : log.dir === 'info' ? 'var(--syn-fn)' : 'var(--ide-text-faint)',
                       marginBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: '2px',
                       wordBreak: "break-all"
                     }}>
                       <span style={{ color: log.dir === 'in' ? 'var(--syn-str)' : log.dir === 'out' ? 'var(--ide-accent)' : 'inherit', marginRight: '8px' }}>
                         [{log.dir.toUpperCase()}]
                       </span>
                       [{log.time}] {log.msg}
                     </div>
                   ))}
                   {lspLogs.length === 0 && <div style={{ color: "var(--ide-text-faint)", fontStyle: "italic" }}>No LSP activity yet...</div>}
                 </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── STATUS BAR ────────────────────────────────────────────────── */}
      <div className="ide-statusbar">
        <div className="statusbar-left">
          <span className="statusbar-item statusbar-item--board">
            <DeveloperBoardIcon sx={{ fontSize: 11 }} />
            {selectedBoardDef ? selectedBoardDef.name : "No board selected"}
          </span>
          {selectedBoardDef && (
            <span className="statusbar-item">{selectedBoardDef.target}</span>
          )}
          <span className="statusbar-item">Ln 13, Col 1</span>
        </div>
        <div className="statusbar-right">
          {serialConnected && <span className="statusbar-item statusbar-item--ok">● Serial: {serialBaudRate}</span>}
          
          <span className={`statusbar-item ${selectedPort ? "statusbar-item--muted" : "statusbar-item--warn"}`}>
            {selectedPort ? selectedPort : "No port selected"}
          </span>
        </div>
      </div>

      {/* ── BOARD & PORT DIALOG (full modal) ──────────────────────────── */}
      <BoardPortDialog
        open={boardPortDialogOpen}
        onClose={() => setBoardPortDialogOpen(false)}
        onConfirm={handleConfirmBoardPort}
      />
      <AlertDialog />

      <ProjectWizard />

      {/* ── MEMORY MODAL OVERLAY ──────────────────────────────────────────── */}
      {memoryModalOpen && (
        <div className="mem-modal-overlay" onMouseDown={() => setMemoryModalOpen(false)}>
          <div className="mem-modal-content" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mem-modal-header">
              <span>Memory Diagnostics</span>
              <button className="mem-modal-close" onClick={() => setMemoryModalOpen(false)}>
                <CloseIcon sx={{ fontSize: 18 }} />
              </button>
            </div>
            <div className="mem-modal-body">
              <MemoryDashboard />
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
