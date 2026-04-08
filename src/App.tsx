import { useEffect } from "react";
import { useIDEStore } from "./store/useIDEStore";
import { Play, Upload, Save, Settings, FolderTree, Cpu, Terminal as TerminalIcon } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Editor } from "./components/Editor";

function App() {
  const { logs, isBuilding, addLog } = useIDEStore();

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans">
      {/* Toolbar */}
      <header className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-white/5 h-14 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button className="p-2 hover:bg-slate-800 rounded-full text-emerald-500 transition-colors" title="Build">
              <Play size={20} fill="currentColor" />
            </button>
            <button className="p-2 hover:bg-slate-800 rounded-full text-emerald-500 transition-colors" title="Upload">
              <Upload size={20} />
            </button>
          </div>
          <div className="h-6 w-[1px] bg-white/10 mx-2" />
          <button className="p-2 hover:bg-slate-800 rounded-md text-slate-400" title="Save">
            <Save size={18} />
          </button>
        </div>

        <div className="flex items-center gap-4 bg-slate-800/50 px-3 py-1.5 rounded-md border border-white/5">
          <Cpu size={16} className="text-emerald-500" />
          <span className="text-sm font-medium">ESP32-C3</span>
          <span className="text-xs text-slate-500">COM4</span>
        </div>

        <div className="flex items-center gap-1">
          <button className="p-2 hover:bg-slate-800 rounded-md text-slate-400">
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* Main Content with Resizable Panels */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Mini (Static) */}
        <nav className="w-12 bg-slate-950 border-r border-white/5 flex flex-col items-center py-4 gap-4 flex-shrink-0">
          <button className="p-2 text-emerald-500 bg-emerald-500/10 rounded-md">
            <FolderTree size={20} />
          </button>
          <button className="p-2 text-slate-600 hover:text-slate-400 transition-colors">
            <Cpu size={20} />
          </button>
          <button className="p-2 text-slate-600 hover:text-slate-400 transition-colors mt-auto">
            <Settings size={20} />
          </button>
        </nav>

        <PanelGroup direction="horizontal" className="flex-1">
          {/* Sidebar Panel (Explorer) */}
          <Panel defaultSize={20} minSize={15} collapsible={true} className="bg-slate-900/50 flex flex-col">
            <div className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500 select-none">Explorador</div>
            <div className="px-4 text-sm text-emerald-400/80 font-mono py-1 bg-white/5 border-l-2 border-emerald-500 cursor-pointer">sketch_apr08.rs</div>
            <div className="px-4 text-sm text-slate-500 font-mono mt-1 hover:text-slate-300 cursor-pointer transition-colors">Cargo.toml</div>
          </Panel>

          <PanelResizeHandle className="w-[1px] bg-white/10 hover:bg-emerald-500 transition-colors duration-300" />

          {/* Editor & Console Panel Group */}
          <Panel defaultSize={80} className="flex flex-col min-w-0">
            <PanelGroup direction="vertical">
              {/* Editor Panel */}
              <Panel defaultSize={70} minSize={20} className="flex flex-col bg-editor min-w-0">
                <div className="h-9 bg-slate-900 border-b border-white/5 flex items-center px-4">
                  <span className="text-xs text-slate-300 border-b-2 border-emerald-500 h-full flex items-center px-2">main.rs</span>
                </div>
                <Editor />
              </Panel>

              <PanelResizeHandle className="h-[1px] bg-white/10 hover:bg-emerald-500 transition-colors duration-300" />

              {/* Bottom Console Panel */}
              <Panel defaultSize={30} minSize={10} collapsible={true} className="bg-slate-950 flex flex-col">
                <div className="flex items-center px-4 py-1.5 bg-slate-900 border-b border-white/5 gap-4 select-none">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                    <TerminalIcon size={12} /> Console
                  </span>
                </div>
                <div className="flex-1 p-3 font-mono text-xs overflow-y-auto space-y-1 selection:bg-emerald-500/30">
                  {logs.map((log, i) => (
                    <div key={i} className="text-slate-400 leading-relaxed">{log}</div>
                  ))}
                  {isBuilding && <div className="text-emerald-500 animate-pulse">Building project...</div>}
                </div>
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>

      {/* Status Bar */}
      <footer className="h-6 bg-emerald-600 text-white flex items-center px-3 justify-between text-[10px] font-medium z-10">
        <div className="flex gap-4">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-white opacity-80" /> Ready</span>
          <span>Ln 1, Col 1</span>
        </div>
        <div className="flex gap-4">
          <span>UTF-8</span>
          <span>Rust 1.77.0</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
