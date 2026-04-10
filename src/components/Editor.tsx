import { invoke } from "@tauri-apps/api/core";
import { Editor as MonacoEditor } from "@monaco-editor/react";
import { useIDEStore } from "../store/useIDEStore";

export function Editor() {
  const { content, setContent, activeFile, addLog } = useIDEStore();

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      if (activeFile) {
        try {
          const currentContent = editor.getValue();
          // Pushes text from the editor model to disk using the active file path
          await invoke("save_file", { path: activeFile, content: currentContent });
          addLog(`✓ Saved ${activeFile.split(/[/\\]/).pop()}`);
        } catch (e) {
          addLog(`[Error] Failed to save file: ${e}`);
        }
      }
    });
  };

  return (
    <MonacoEditor
      height="100%"
      defaultLanguage="rust"
      theme="vs-dark"
      value={content}
      onChange={(value) => setContent(value || "")}
      onMount={handleEditorDidMount}
      options={{
        minimap: { enabled: true },
        fontSize: 13,
        fontFamily: "JetBrains Mono, Fira Code, 'Courier New', monospace",
        lineHeight: 21,
        cursorBlinking: "smooth",
        smoothScrolling: true,
        contextmenu: true,
        renderLineHighlight: "line",
        lineNumbers: "on",
        glyphMargin: true, // enabled for potential debug breakpoints/diagnostics
        folding: true,
        padding: { top: 10 },
        scrollbar: {
          vertical: "visible",
          horizontal: "visible",
          useShadows: false,
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
      }}
    />
  );
}
