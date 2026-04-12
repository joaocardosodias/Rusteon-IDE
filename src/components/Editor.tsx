import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import MonacoEditor from "@monaco-editor/react";
import { useIDEStore } from "../store/useIDEStore";
import { useDebugStore } from "../store/useDebugStore";
import { LspClient } from "../api/lspClient";

export function Editor() {
  const { content, setContent, activeFile, activeProjectPath, addLog } = useIDEStore();

  const lspRef = useRef<LspClient | null>(null);
  const monacoRef = useRef<any>(null);
  const editorRef = useRef<any>(null);
  const debounceTimer = useRef<any>(null);
  const providersRef = useRef<any[]>([]);
  const decorationsColRef = useRef<any>(null);

  const debugBreakpoints = useDebugStore((state) => state.breakpoints);
  const debugActiveLine = useDebugStore((state) => state.activeLine);

  // Helper: always get the freshest activeFile from the store (avoids stale closures)
  const getActiveFile = () => useIDEStore.getState().activeFile;

  // ──── LSP Lifecycle Management ──────────────────────────────────────────────
  useEffect(() => {
    if (!activeProjectPath) return;

    const startLsp = async () => {
      // Clean up previous instance if any
      if (lspRef.current) {
        await lspRef.current.stop();
      }

      lspRef.current = new LspClient((uri, diagnostics) => {
        // Handle server-pushed diagnostics (errors/warnings)
        const monaco = monacoRef.current;
        if (!monaco) return;
        
        // Find the model matching this URI across all open models
        const models = monaco.editor.getModels();
        for (const model of models) {
          if (model.uri.toString() === uri) {
            const markers = diagnostics.map((d: any) => ({
              severity: d.severity === 1 
                ? monaco.MarkerSeverity.Error 
                : d.severity === 2 
                  ? monaco.MarkerSeverity.Warning 
                  : monaco.MarkerSeverity.Info,
              startLineNumber: d.range.start.line + 1,
              startColumn: d.range.start.character + 1,
              endLineNumber: d.range.end.line + 1,
              endColumn: d.range.end.character + 1,
              message: d.message,
              source: d.source || "rust-analyzer"
            }));
            monaco.editor.setModelMarkers(model, "rust-analyzer", markers);
            break;
          }
        }

        // Also try the current editor model by checking the active file
        const currentFile = getActiveFile();
        if (currentFile && editorRef.current) {
          const model = editorRef.current.getModel();
          if (model && `file://${currentFile}` === uri) {
            const markers = diagnostics.map((d: any) => ({
              severity: d.severity === 1 
                ? monaco.MarkerSeverity.Error 
                : d.severity === 2 
                  ? monaco.MarkerSeverity.Warning 
                  : monaco.MarkerSeverity.Info,
              startLineNumber: d.range.start.line + 1,
              startColumn: d.range.start.character + 1,
              endLineNumber: d.range.end.line + 1,
              endColumn: d.range.end.character + 1,
              message: d.message,
              source: d.source || "rust-analyzer"
            }));
            monaco.editor.setModelMarkers(model, "rust-analyzer", markers);
          }
        }
      });

      const started = await lspRef.current.start(activeProjectPath);
      if (started) {
        addLog("✓ rust-analyzer ready.");
        const file = getActiveFile();
        if (file) {
          const val = editorRef.current ? editorRef.current.getValue() : content;
          lspRef.current.didOpen(file, val);
        }
        setupMonacoProviders();
      } else {
        addLog("[Error] Failed to start rust-analyzer.");
      }
    };

    startLsp();

    // Listen for LSP crash / close to auto-restart
    const unlistenClose = listen<string>("lsp-close", async () => {
      addLog("[LSP] Process exited. Attempting restart...");
      if (lspRef.current) {
        lspRef.current.isInitialized = false;
      }
      // Small delay before restart
      setTimeout(() => startLsp(), 2000);
    });

    return () => {
      if (lspRef.current) {
        lspRef.current.stop();
        lspRef.current = null;
      }
      unlistenClose.then(f => f());
      // dispose language features
      providersRef.current.forEach(p => p.dispose());
      providersRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectPath]);

  // ──── File opened ───────────────────────────────────────
  useEffect(() => {
    if (lspRef.current && activeFile && lspRef.current.isInitialized) {
      if (editorRef.current) {
        const value = editorRef.current.getValue();
        lspRef.current.didOpen(activeFile, value);
      }
    }
  }, [activeFile]);

  // ──── Reative Debugging Decorations ─────────────────────────────────────────
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !activeFile) return;
    const monaco = monacoRef.current;
    
    if (!decorationsColRef.current) {
      decorationsColRef.current = editorRef.current.createDecorationsCollection();
    }
    
    const fileBps = debugBreakpoints[activeFile] || [];
    
    const newDecorations: any[] = fileBps.map((line: number) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: 'debug-breakpoint-glyph',
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
    }));
    
    if (debugActiveLine && debugActiveLine.path === activeFile) {
      newDecorations.push({
        range: new monaco.Range(debugActiveLine.line, 1, debugActiveLine.line, 1),
        options: {
          isWholeLine: true,
          className: 'debug-active-line',
          glyphMarginClassName: 'debug-active-glyph',
        }
      });
    }

    decorationsColRef.current.set(newDecorations);
  }, [debugBreakpoints, debugActiveLine, activeFile]);

  // ──── Register Providers ──────────────────────────────────────────────────
  const setupMonacoProviders = useCallback(() => {
    if (!monacoRef.current || !lspRef.current) return;
    const monaco = monacoRef.current;
    
    // Clear previous
    providersRef.current.forEach(p => p.dispose());
    providersRef.current = [];

    // Hover
    const hoverProv = monaco.languages.registerHoverProvider("rust", {
      provideHover: async (_model: any, position: any) => {
        const file = getActiveFile();
        if (!lspRef.current || !file) return null;
        try {
          const res = await lspRef.current.sendRequest("textDocument/hover", {
            textDocument: { uri: `file://${file}` },
            position: { line: position.lineNumber - 1, character: position.column - 1 }
          });
          if (res && res.contents) {
            // rust-analyzer returns contents as MarkupContent {kind, value} or string
            let contentValue: string;
            if (typeof res.contents === 'string') {
              contentValue = res.contents;
            } else if (res.contents.value) {
              contentValue = res.contents.value;
            } else if (Array.isArray(res.contents)) {
              contentValue = res.contents.map((c: any) => typeof c === 'string' ? c : c.value).join('\n');
            } else {
              contentValue = JSON.stringify(res.contents);
            }

            const result: any = {
              contents: [{ value: contentValue }]
            };

            // range is optional in the LSP spec
            if (res.range) {
              result.range = new monaco.Range(
                res.range.start.line + 1, res.range.start.character + 1,
                res.range.end.line + 1, res.range.end.character + 1
              );
            }

            return result;
          }
        } catch (e) {
          // timeout or error silently handled
          console.debug("Hover error:", e);
        }
        return null;
      }
    });

    // Completion
    const compProv = monaco.languages.registerCompletionItemProvider("rust", {
      triggerCharacters: [".", ":", "<"],
      provideCompletionItems: async (model: any, position: any) => {
        const file = getActiveFile();
        if (!lspRef.current || !file) return { suggestions: [] };
        try {
          const res = await lspRef.current.sendRequest("textDocument/completion", {
            textDocument: { uri: `file://${file}` },
            position: { line: position.lineNumber - 1, character: position.column - 1 }
          });

          if (!res) return { suggestions: [] };

          // Some LSPs return an array, some return { items: [] }
          const items = Array.isArray(res) ? res : (res?.items || []);
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn
          };

          const suggestions = items.map((item: any) => ({
            label: item.label,
            kind: item.kind,
            insertText: item.textEdit?.newText || item.insertText || item.label,
            detail: item.detail,
            documentation: item.documentation?.value || item.documentation,
            range,
            sortText: item.sortText,
            filterText: item.filterText
          }));

          return { suggestions };
        } catch (e) {
          console.debug("Completion error:", e);
          return { suggestions: [] };
        }
      }
    });

    // Definition (Ctrl+Click / F12)
    const defProv = monaco.languages.registerDefinitionProvider("rust", {
      provideDefinition: async (_model: any, position: any) => {
        const file = getActiveFile();
        if (!lspRef.current || !file) return null;
        try {
          const res = await lspRef.current.sendRequest("textDocument/definition", {
            textDocument: { uri: `file://${file}` },
            position: { line: position.lineNumber - 1, character: position.column - 1 }
          });
          if (!res) return null;
          
          const resolveLocation = (loc: any) => {
            // Handle LocationLink (targetUri/targetRange) format
            const uri = loc.targetUri || loc.uri;
            const range = loc.targetRange || loc.range;
            if (!uri || !range) return null;
            return {
              uri: monaco.Uri.parse(uri),
              range: {
                startLineNumber: range.start.line + 1,
                startColumn: range.start.character + 1,
                endLineNumber: range.end.line + 1,
                endColumn: range.end.character + 1
              }
            };
          };

          if (Array.isArray(res)) return res.map(resolveLocation).filter(Boolean);
          return resolveLocation(res);
        } catch (e) {
          console.debug("Definition error:", e);
          return null;
        }
      }
    });

    providersRef.current.push(hoverProv, compProv, defProv);
  }, []);

  // ──── Editor Events ───────────────────────────────────────────────────────
  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Ctrl+S Hook
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      const file = getActiveFile();
      if (file) {
        try {
          const currentContent = editor.getValue();
          await invoke("save_file", { path: file, content: currentContent });
          addLog(`✓ Saved ${file.split(/[/\\]/).pop()}`);
          
          if (lspRef.current) {
            lspRef.current.didSave(); // sync disk state for LSP
          }
        } catch (e) {
          addLog(`[Error] Failed to save file: ${e}`);
        }
      }
    });

    // Breakpoints Click Handling
    editor.onMouseDown((e: any) => {
      // Target types: 4 = GUTTER_GLYPH_MARGIN, 2 = GUTTER_LINE_NUMBERS, 3 = GUTTER_LINE_DECORATIONS
      if (e.target && (e.target.type === 4 || e.target.type === 2 || e.target.type === 3)) {
        const line = e.target.position?.lineNumber;
        const file = getActiveFile();
        if (file && line) {
          useDebugStore.getState().toggleBreakpoint(file, line);
        }
      }
    });

    // Initialize providers if LSP was ready early
    if (lspRef.current && lspRef.current.isInitialized) {
      setupMonacoProviders();
    }
  };

  const handleBeforeMount = (monaco: any) => {
    monaco.editor.defineTheme("ferris-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
  // — Keywords —
  { token: 'keyword',             foreground: '#ff7a3c', fontStyle: 'bold' },
  { token: 'keyword.control',     foreground: '#ff6a2f', fontStyle: 'bold' },
  { token: 'keyword.directive',   foreground: '#c55314' }, 
  { token: 'keyword.operator',    foreground: '#e89a5a' },

  // — Funções —
  { token: 'identifier.function', foreground: '#f2b84a' },
  { token: 'support.function',    foreground: '#f2b84a' },

  // — Tipos —
  { token: 'type.identifier',     foreground: '#d49a3a' },
  { token: 'entity.name.type',    foreground: '#d49a3a' },
  { token: 'storage.type',        foreground: '#d49a3a' },

  // — Strings —
  { token: 'string',              foreground: '#8ccf6a' },
  { token: 'string.escape',       foreground: '#b4e890' },

  // — Números —
  { token: 'number',              foreground: '#e0a040' },
  { token: 'number.float',        foreground: '#e0a040' },
  { token: 'number.hex',          foreground: '#c9872a' },

  // — Comentários —
  { token: 'comment',             foreground: '#b1722fff', fontStyle: 'italic' },
  { token: 'comment.doc',         foreground: '#af7435ff', fontStyle: 'italic' },

  // — Macros / Anotações —
  { token: 'annotation',          foreground: '#ff8a3c' },
  { token: 'macro',               foreground: '#ff8a3c', fontStyle: 'bold' },

  // — Operadores e pontuação —
  { token: 'operator',            foreground: '#c89a60' },
  { token: 'delimiter',           foreground: '#7a5a30' },

  // — Variáveis —
  { token: 'variable',            foreground: '#e6c68a' },
  { token: 'variable.parameter',  foreground: '#d0a870' },

  // — Constantes —
  { token: 'constant',            foreground: '#ff9a5a' },
  { token: 'constant.language',   foreground: '#ff9a5a' },
],
      colors: {
        "editor.background": "#0d0d0e98",
        "editor.foreground": "#e2e4e7",
        "editor.lineHighlightBackground": "#18191b",
        "editor.selectionBackground": "#ff9e0022",
        "editor.inactiveSelectionBackground": "#ff9e0011",
        "editorCursor.foreground": "#ff9e00",
        "editorWhitespace.foreground": "#2a2c2f",
        "editorIndentGuide.background": "#1c1e21",
        "editorIndentGuide.activeBackground": "#2a2c2f",
        "editorLineNumber.foreground": "#5a5f66",
        "editorLineNumber.activeForeground": "#ff9e00",
        "editorWidget.background": "#141517",
        "editorWidget.border": "#2a2c2f",
        "editorSuggestWidget.background": "#1c1e21",
        "editorSuggestWidget.border": "#2a2c2f",
        "editorSuggestWidget.foreground": "#cdd6f4",
        "editorSuggestWidget.highlightForeground": "#ff9e00",
        "editorSuggestWidget.focusHighlightForeground": "#ff9e00",
        "editorSuggestWidget.selectedBackground": "#ff9e0033",
        "editorSuggestWidget.selectedForeground": "#ffffff",
        "menu.background": "#1c1e21",
        "menu.selectionBackground": "#ff9e0033",
        "menu.foreground": "#cdd6f4",
        "menu.selectionForeground": "#ffffff",
        // Hover / diagnostic widget
        "editorHoverWidget.background": "#1a1c20",
        "editorHoverWidget.border": "#2a2c2f",
        "editorHoverWidget.foreground": "#c9d1d9",
        "editorHoverWidget.statusBarBackground": "#141517",
        "editorHoverWidget.highlightForeground": "#ff9e00",
        // Links inside hover
        "textLink.foreground": "#ff9e00",
        "textLink.activeForeground": "#ffb732",
        // Error/warning squiggle colours
        "editorError.foreground": "#f87171",
        "editorWarning.foreground": "#fbbf24",
        "editorInfo.foreground": "#60a5fa",
      },
    });
  };

  const handleEditorChange = (value: string | undefined) => {
    const val = value || "";
    setContent(val);
    
    // 300ms Debounce to prevent massive cpu overhead
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const file = getActiveFile();
      if (lspRef.current && file) {
        lspRef.current.didChange(val);
      }
    }, 300);
  };

  return (
    <div style={{ height: '100%', background: '#0d0e10' }}>
      <MonacoEditor
        height="100%"
        defaultLanguage="rust"
        theme="ferris-dark"
        value={content}
        onChange={handleEditorChange}
        onMount={handleEditorDidMount}
        beforeMount={handleBeforeMount}
        loading={<div style={{ color: '#5a5f66', background: '#0d0e10', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading Editor...</div>}
        options={{
          minimap: { enabled: false },
          fontSize: 13.5,
          fontFamily: "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Fira Code', monospace",
          lineHeight: 22,
          cursorBlinking: "smooth",
          smoothScrolling: true,
          contextmenu: true,
          renderLineHighlight: "line",
          lineNumbers: "relative",
          glyphMargin: true, 
          folding: true,
          padding: { top: 12 },
          bracketPairColorization: { enabled: true },
          scrollbar: {
            vertical: "visible",
            horizontal: "visible",
            useShadows: false,
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
          fixedOverflowWidgets: true,
          scrollBeyondLastLine: false,
          stickyScroll: { enabled: false },
          hover: {
            above: true,
            delay: 400
          }
        }}
      />
    </div>
  );
}
