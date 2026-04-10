import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LibraryManager } from "./LibraryManager";
import { BoardManager } from "./BoardManager";
import { Editor } from "./Editor";
import { BoardSelectorButton } from "./BoardSelectorButton";
import { SerialPortDialog } from "./SerialPortDialog";
import { BoardPortDialog } from "./BoardPortDialog";
import { ProjectExplorer } from "./ProjectExplorer";
import { ProjectWizard } from "./ProjectWizard";
import { useIDEStore } from "../store/useIDEStore";
import { BOARDS } from "../data/boards";
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
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import RefreshIcon from "@mui/icons-material/Refresh";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";

// ─── Log line types ───────────────────────────────────────────────────────────
type BTab = "out" | "serial" | "errors";
type LogLine = { text: string; type: "ok" | "err" | "warn" | "dim" | "prompt" | "plain" };

// ─── Main IDE Layout ─────────────────────────────────────────────────────────
export function IDELayout() {

  const [activeSidebar, setActiveSidebar] = useState<number | null>(1);
  const [activeBottomTab, setActiveBottomTab] = useState<BTab>("out");
  const [outputLines, setOutputLines] = useState<LogLine[]>([
    { text: "Rusteon IDE v0.1 — Ready", type: "dim" },
    { text: "waiting...", type: "dim" },
  ]);
  const [serialLines, setSerialLines] = useState<LogLine[]>([
    { text: "── Serial Monitor ──", type: "dim" },
  ]);
  const [serialRunning, setSerialRunning] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(180);
  const [isDragging, setIsDragging] = useState(false);
  const [sideWidth, setSideWidth] = useState(260);
  const [isSideDragging, setIsSideDragging] = useState(false);

  // Board selector state from Zustand
  const serialDialogOpen    = useIDEStore((state) => state.serialDialogOpen);
  const boardPortDialogOpen = useIDEStore((state) => state.boardPortDialogOpen);
  const setSerialDialogOpen    = useIDEStore((state) => state.setSerialDialogOpen);
  const setBoardPortDialogOpen = useIDEStore((state) => state.setBoardPortDialogOpen);
  const setSelectedPort = useIDEStore((state) => state.setSelectedPort);
  const selectedPort    = useIDEStore((state) => state.selectedPort);
  const selectedBoard   = useIDEStore((state) => state.selectedBoard);
  const setSelectedBoard = useIDEStore((state) => state.setSelectedBoard);

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
  const featureDiagnostics = useIDEStore((state) => state.featureDiagnostics);
  const setFeatureDiagnostics = useIDEStore((state) => state.setFeatureDiagnostics);

  const serialTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const serialRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

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
        setActiveProject(selected, folderName);
      }
    } catch (e) {
      addLog(`[Error] Dialog failed: ${e}`);
    }
  };

  useEffect(() => {
    const unlistenBuild = listen<any>("ide-build-log", (event) => {
      let type: "plain" | "error" | "warn" | "dim" | "ok" = "plain";
      const txt = event.payload.line;
      if (txt.includes("error:") || txt.includes("error[")) type = "error";
      else if (txt.includes("warning:")) type = "warn";
      else if (txt.trim().startsWith("Compiling") || txt.trim().startsWith("Finished") || txt.trim().startsWith("Running")) type = "ok";
      
      setOutputLines(prev => [...prev, { text: txt, type }]);
    });
    const unlistenFlash = listen<any>("ide-flash-log", (event) => {
      setOutputLines(prev => [...prev, { text: event.payload.line, type: "plain" }]);
    });
    return () => {
      unlistenBuild.then(f => f());
      unlistenFlash.then(f => f());
    };
  }, []);

  const handleCancelProcess = async () => {
    try {
      await invoke("cancel_process");
    } catch (e) {
      addLog(`Failed to cancel: ${e}`);
    }
  };

  const autoSaveActiveFile = async (): Promise<boolean> => {
    if (!activeFile || !content) return true; // nothing to save
    try {
      await invoke("save_file", { path: activeFile, content });
      setOutputLines(prev => [...prev, { text: `  💾 Auto-saved ${activeFile.split(/[/\\]/).pop()}`, type: "dim" }]);
      return true;
    } catch (e) {
      setOutputLines(prev => [...prev, { text: `[Error] Auto-save failed: ${e}`, type: "error" }]);
      return false;
    }
  };

  const runDiagnosticsOnFailure = async () => {
    if (!activeProjectPath) return;
    try {
      const diags = await invoke<any[]>("check_project", { projectPath: activeProjectPath });
      if (diags && diags.length > 0) {
        setFeatureDiagnostics(diags);
        setOutputLines(prev => [...prev, { 
          text: `⚠ ${diags.length} missing features detected. Check the Library Manager -> Diagnostics tab to fix them.`, 
          type: "warn" 
        }]);
      } else {
        setFeatureDiagnostics([]);
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
      handleCancelProcess();
      return;
    }
    setIsBuilding(true);
    setActiveBottomTab("out");
    setOutputLines([{ text: "> cargo build --release", type: "prompt" }]);
    
    try {
      // Always save before building so cargo compiles the latest code
      const saved = await autoSaveActiveFile();
      if (!saved) { setIsBuilding(false); return; }

      const res = await invoke<string>("build_project", { projectPath: activeProjectPath });
      setOutputLines(prev => [...prev, { text: `✓ ${res}`, type: "ok" }]);
      setFeatureDiagnostics([]); // clear on success
    } catch (e) {
      setOutputLines(prev => [...prev, { text: `[Error] ${e}`, type: "error" }]);
      await runDiagnosticsOnFailure();
    } finally {
      setIsBuilding(false);
    }
  };

  const handleFlash = async () => {
    if (!activeProjectPath) {
      addLog("No project opened for flash.");
      return;
    }
    if (isBuilding || isFlashing) {
      handleCancelProcess();
      return;
    }
    setIsFlashing(true);
    setActiveBottomTab("out");
    
    setOutputLines([{ text: "> Upload starting...", type: "prompt" }]);
    try {
      // 1. Auto-save before any compilation
      const saved = await autoSaveActiveFile();
      if (!saved) { setIsFlashing(false); return; }

      // 2. Build
      setOutputLines(prev => [...prev, { text: "> cargo build --release", type: "prompt" }]);
      await invoke<string>("build_project", { projectPath: activeProjectPath });
      
      // 3. Flash
      setOutputLines(prev => [...prev, { text: "> Flashing...", type: "prompt" }]);
      const res = await invoke<string>("flash_firmware", {
        projectPath: activeProjectPath,
        flashTool: selectedBoardDef?.flashTool || "espflash",
        port: selectedPort === "Auto" ? null : selectedPort
      });
      setOutputLines(prev => [...prev, { text: `✓ ${res}`, type: "ok" }]);
      setFeatureDiagnostics([]); // clear on success
    } catch (e) {
      setOutputLines(prev => [...prev, { text: `[Error] Deploy failed: ${e}`, type: "error" }]);
      // Fallback: check if the error was a compile error masquerading as a deploy error
      // Actually build_project fails first if it didn't compile, but probe-rs / espflash
      // might fail compilation if used directly. We just safely run diagnostics either way.
      await runDiagnosticsOnFailure();
    } finally {
      setIsBuilding(false);
      setIsFlashing(false);
    }
  };

  const handleSaveFile = async () => {
    if (activeFile && content) {
      try {
        await invoke("save_file", { path: activeFile, content });
        addLog(`✓ Saved ${activeFile.split(/[/\\]/).pop()}`);
      } catch (e) {
        addLog(`[Error] Failed to save file: ${e}`);
      }
    }
  };

  const handleSerial = () => {
    setActiveBottomTab("serial");
    if (serialRunning) {
      if (serialTickRef.current) clearInterval(serialTickRef.current);
      setSerialRunning(false);
      setSerialLines((prev) => [...prev, { text: "── Serial closed ──", type: "warn" }]);
      return;
    }
    setSerialRunning(true);
    setSerialLines((prev) => [...prev, { text: "── Serial open — 115200 ──", type: "ok" }]);
    const msgs = ["LED on", "LED off"];
    let i = 0;
    serialTickRef.current = setInterval(() => {
      const ts = new Date().toTimeString().slice(0, 8);
      setSerialLines((prev) => [...prev, { text: `[${ts}] ${msgs[i % 2]}`, type: "plain" }]);
      i++;
    }, 500);
  };

  // Auto-scroll console
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [outputLines]);
  useEffect(() => {
    if (serialRef.current) serialRef.current.scrollTop = serialRef.current.scrollHeight;
  }, [serialLines]);

  // ── Resizable bottom panel drag ──────────────────────────────────────────
  const onDragMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartH.current = bottomHeight;
    setIsDragging(true);
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const delta = dragStartY.current - e.clientY;
    const newH = Math.min(500, Math.max(80, dragStartH.current + delta));
    setBottomHeight(newH);
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

  const onSideMouseMove = useCallback((e: MouseEvent) => {
    if (!isSideDragging) return;
    const delta = e.clientX - dragStartX.current;
    const newW = Math.min(800, Math.max(150, dragStartW.current + delta));
    setSideWidth(newW);
  }, [isSideDragging, sideWidth]);

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

  const logColor = (type: LogLine["type"]) => {
    if (type === "ok") return "var(--syn-str)";
    if (type === "err") return "#e06c75";
    if (type === "warn") return "var(--syn-num)";
    if (type === "dim") return "var(--ide-text-faint)";
    if (type === "prompt") return "var(--syn-fn)";
    return "var(--ide-text)";
  };

  const sidebarLabel = ["Explorer", "Boards", "Libraries", "Examples", "Search", "Settings"];
  
  const selectedBoardDef = BOARDS.find((b) => b.id === selectedBoard);

  return (
    <div className="ide-root">

      {/* ── MENU BAR ──────────────────────────────────────────────────── */}
      <div className="ide-menubar">
        {["File", "Edit", "Sketch", "Tools", "Help"].map((item) => (
          <span key={item} className="ide-menu-item">{item}</span>
        ))}
        <span className="ide-menu-spacer" />
        <span className="ide-menu-badge">Rusteon IDE v0.1</span>
      </div>

      {/* ── TOOLBAR ───────────────────────────────────────────────────── */}
      <div className="ide-toolbar">
        <div className="ide-toolbar-actions">
          <button
            id="btn-build"
            className={`tool-btn tool-btn--primary ${isBuilding ? "tool-btn--busy" : ""}`}
            onClick={handleBuild}
            title={isBuilding ? "Cancel Build" : "Verify / Build (Ctrl+R)"}
          >
            {isBuilding
              ? <CloseIcon sx={{ fontSize: 22, color: '#fff' }} />
              : <CheckIcon sx={{ fontSize: 22, color: '#fff' }} />}
          </button>

          <button
            id="btn-upload"
            className={`tool-btn tool-btn--primary ${isFlashing ? "tool-btn--busy" : ""}`}
            onClick={handleFlash}
            title={isFlashing ? "Cancel Upload" : "Upload / Flash (Ctrl+U)"}
          >
            {isFlashing
              ? <CloseIcon sx={{ fontSize: 22, color: '#fff' }} />
              : <FileUploadIcon sx={{ fontSize: 22, color: '#fff' }} />}
          </button>

          <div className="tool-btn-divider" />

          <button id="btn-debug" className="tool-btn tool-btn--ghost" title="Debug">
            <BugReportIcon sx={{ fontSize: 22 }} />
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
          title={serialRunning ? "Close Serial" : "Open Serial Monitor"}
          onClick={handleSerial}
          className={`tool-btn tool-btn--ghost tool-btn--serial ${serialRunning ? "tool-btn--active" : ""}`}
        >
          <UsbIcon sx={{ fontSize: 22 }} />
          <span className="tool-btn-label" style={{ fontSize: '11.5px' }}>{serialRunning ? "Serial ●" : "Serial"}</span>
        </button>
      </div>

      {/* ── TAB BAR ───────────────────────────────────────────────────── */}
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
            <InsertDriveFileIcon sx={{ fontSize: 13, opacity: 0.6 }} />
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
                      style={{ marginTop: '20px', padding: '6px 16px', borderRadius: '4px', backgroundColor: 'var(--ide-teal)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600 }}
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
              {(["out", "serial", "errors"] as BTab[]).map((tab) => {
                const labels: Record<BTab, string> = { out: "Output", serial: "Serial Monitor", errors: "Errors" };
                const isActive = activeBottomTab === tab;
                return (
                  <button
                    key={tab}
                    id={`btab-${tab}`}
                    onClick={() => setActiveBottomTab(tab)}
                    className={`bottom-tab ${isActive ? "bottom-tab--active" : ""}`}
                  >
                    {labels[tab]}
                    {tab === "errors" && <span className="bottom-tab-badge bottom-tab-badge--ok">0</span>}
                    {tab === "serial" && serialRunning && <span className="bottom-tab-indicator" />}
                  </button>
                );
              })}
              <div className="ide-bottom-tabs-spacer" />
              <button
                className="bottom-panel-action"
                title="Clear console"
                onClick={() => {
                  if (activeBottomTab === "out") setOutputLines([]);
                  else setSerialLines([{ text: "── Serial Monitor ──", type: "dim" }]);
                }}
              >
                <DeleteSweepIcon sx={{ fontSize: 15 }} />
              </button>
            </div>

            {/* Output Tab */}
            {activeBottomTab === "out" && (
              <div ref={outputRef} className="console-output">
                {outputLines.map((line, i) => (
                  <div key={i} className="console-line" style={{ color: logColor(line.type) }}>{line.text}</div>
                ))}
                <div className="console-line">
                  <span style={{ color: "var(--syn-fn)" }}>&gt;</span>{" "}
                  <span style={{ color: "var(--ide-text-faint)" }}>waiting...</span>{" "}
                  <span className="t-blink" />
                </div>
              </div>
            )}

            {/* Serial Tab */}
            {activeBottomTab === "serial" && (
              <div ref={serialRef} className="console-output">
                {serialLines.map((line, i) => (
                  <div key={i} className="console-line">
                    {line.type === "plain"
                      ? <span style={{ color: "var(--ide-text-faint)" }}>{line.text.split("]")[0]}]</span>
                      : null}
                    <span style={{ color: logColor(line.type), marginLeft: line.type === "plain" ? 4 : 0 }}>
                      {line.type === "plain" ? line.text.split("] ")[1] : line.text}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Errors Tab */}
            {activeBottomTab === "errors" && (
              <div className="console-output">
                <div className="console-line" style={{ color: "var(--syn-str)" }}>✓ No errors found.</div>
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
          {serialRunning && <span className="statusbar-item statusbar-item--ok">● Serial: 115200</span>}
          
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

      <ProjectWizard />

    </div>
  );
}
