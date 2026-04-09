import { Editor as MonacoEditor } from "@monaco-editor/react";
import { useIDEStore } from "../store/useIDEStore";

export function Editor() {
  const { content, setContent } = useIDEStore();

  return (
    <MonacoEditor
      height="100%"
      defaultLanguage="rust"
      theme="vs-dark"
      value={content}
      onChange={(value) => setContent(value || "")}
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
        glyphMargin: false,
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
