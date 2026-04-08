import { Editor as MonacoEditor } from "@monaco-editor/react";
import { useIDEStore } from "../store/useIDEStore";

export function Editor() {
  const { content, setContent } = useIDEStore();

  return (
    <div className="flex-1 w-full h-full min-h-0">
      <MonacoEditor
        height="100%"
        defaultLanguage="rust"
        theme="vs-dark"
        value={content}
        onChange={(value) => setContent(value || "")}
        options={{
          minimap: { enabled: true },
          fontSize: 14,
          fontFamily: "JetBrains Mono, Fira Code, monospace",
          cursorBlinking: "smooth",
          smoothScrolling: true,
          contextmenu: true,
          renderLineHighlight: "all",
          scrollbar: {
            vertical: "visible",
            horizontal: "visible",
            useShadows: false,
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
        }}
      />
    </div>
  );
}
