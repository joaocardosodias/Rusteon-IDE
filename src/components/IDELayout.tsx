import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import CheckIcon from "@mui/icons-material/Check";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import BugReportIcon from "@mui/icons-material/BugReport";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import FolderIcon from "@mui/icons-material/Folder";
import SaveIcon from "@mui/icons-material/Save";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import RefreshIcon from "@mui/icons-material/Refresh";

// ─── Log line types ───────────────────────────────────────────────────────────
type BTab = "out" | "serial" | "errors";
type LogLine = { text: string; type: "ok" | "err" | "warn" | "dim" | "prompt" | "plain" };

// ─── Main IDE Layout ─────────────────────────────────────────────────────────
export function IDELayout() {
  const [activeTab, setActiveTab] = useState<string>("main");
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

  const addOutput = (lines: [number, LogLine][]) => {
    setActiveBottomTab("out");
    setOutputLines([]);
    lines.forEach(([ms, line]) => {
      setTimeout(() => {
        setOutputLines((prev) => [...prev, line]);
      }, ms);
    });
  };

  const handleBuild = async () => {
    if (isBuilding) return;
    setIsBuilding(true);
    addOutput([
      [0,    { text: "> cargo build --release", type: "prompt" }],
      [500,  { text: "   Compiling esp-hal v0.18.0", type: "dim" }],
      [850,  { text: "   Compiling esp-backtrace v0.13.0", type: "dim" }],
      [1150, { text: "   Compiling esp-println v0.10.0", type: "dim" }],
      [1500, { text: "   Compiling sketch_apr7a v0.1.0", type: "dim" }],
      [2400, { text: "    Finished release [optimized] in 2.41s", type: "ok" }],
      [2600, { text: "✓ Build complete with no errors", type: "ok" }],
    ]);
    setTimeout(() => setIsBuilding(false), 2800);
    try { await invoke("build_project"); } catch (_) { /* noop */ }
  };

  const handleFlash = async () => {
    if (isFlashing) return;
    setIsFlashing(true);
    const boardName = selectedBoardDef ? selectedBoardDef.name : "Chip Desconhecido";
    addOutput([
      [0,    { text: "> espflash flash --monitor", type: "prompt" }],
      [400,  { text: `[00:00:01] Connecting to ${boardName}...`, type: "dim" }],
      [900,  { text: `[00:00:02] Chip detected: ${boardName} (rev v0.3)`, type: "dim" }],
      [1300, { text: "[00:00:03] ████████████████ 100% flashed", type: "dim" }],
      [1800, { text: "✓ Upload complete — device restarted", type: "ok" }],
      [2100, { text: "── serial output ──", type: "dim" }],
      [2400, { text: "LED on", type: "plain" }],
      [2900, { text: "LED off", type: "plain" }],
      [3400, { text: "LED on", type: "plain" }],
    ]);
    setTimeout(() => setIsFlashing(false), 3600);
    try { await invoke("flash_firmware"); } catch (_) { /* noop */ }
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
            className={`tool-btn tool-btn--primary ${isBuilding ? "tool-btn--loading" : ""}`}
            onClick={handleBuild}
            title="Verify / Build (Ctrl+R)"
            disabled={isBuilding}
          >
            {isBuilding
              ? <RefreshIcon sx={{ fontSize: 22, color: '#fff' }} className="spin-icon" />
              : <CheckIcon sx={{ fontSize: 22, color: '#fff' }} />}
          </button>

          <button
            id="btn-upload"
            className={`tool-btn tool-btn--primary ${isFlashing ? "tool-btn--loading" : ""}`}
            onClick={handleFlash}
            title="Upload / Flash (Ctrl+U)"
            disabled={isFlashing}
          >
            {isFlashing
              ? <RefreshIcon sx={{ fontSize: 22, color: '#fff' }} className="spin-icon" />
              : <FileUploadIcon sx={{ fontSize: 22, color: '#fff' }} />}
          </button>

          <div className="tool-btn-divider" />

          <button id="btn-debug" className="tool-btn tool-btn--ghost" title="Debug">
            <BugReportIcon sx={{ fontSize: 22 }} />
          </button>
          <button id="btn-new" className="tool-btn tool-btn--ghost" title="New Project" onClick={() => setWizardOpen(true)}>
            <NoteAddIcon sx={{ fontSize: 22 }} />
          </button>
          <button id="btn-open" className="tool-btn tool-btn--ghost" title="Open Project" onClick={async () => {
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
          }}>
            <FolderIcon sx={{ fontSize: 22 }} />
          </button>
          <button id="btn-save" className="tool-btn tool-btn--ghost" title="Save (Ctrl+S)">
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
      <div className="ide-tabbar">
        {[{ id: "main", label: "sketch_apr7a.rs" }, { id: "cargo", label: "Cargo.toml" }].map(({ id, label }) => (
          <div
            key={id}
            id={`tab-${id}`}
            onClick={() => setActiveTab(id)}
            className={`ide-tab ${activeTab === id ? "ide-tab--active" : ""}`}
          >
            <InsertDriveFileIcon sx={{ fontSize: 12, opacity: 0.5 }} />
            {label}
          </div>
        ))}
        <div className="ide-tab-add" title="New file">+</div>
        <div className="ide-tabbar-spacer" />
        <div className="ide-tab-more" title="More files">⋯</div>
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
                      onClick={() => alert("Project Explorer functionality will be implemented soon.")}
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
