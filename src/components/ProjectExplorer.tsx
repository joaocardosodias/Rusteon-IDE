import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useIDEStore } from "../store/useIDEStore";

// Icons
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import SettingsApplicationsIcon from "@mui/icons-material/SettingsApplications";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[] | null;
}

export function ProjectExplorer() {
  const { activeProjectPath, activeProjectName, setActiveProject, addLog } = useIDEStore();
  const [tree, setTree] = useState<FileNode | null>(null);
  const [loading, setLoading] = useState(false);

  // Load tree when project path changes
  useEffect(() => {
    if (activeProjectPath) {
      loadTree(activeProjectPath);
    } else {
      setTree(null);
    }
  }, [activeProjectPath]);

  const loadTree = async (path: string) => {
    setLoading(true);
    try {
      const rootNode = await invoke<FileNode>("read_dir_recursive", { path });
      setTree(rootNode);
    } catch (e) {
      addLog(`[Error] Failed to load project: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
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

  if (!activeProjectPath) {
    return (
      <div className="side-panel-empty" style={{ padding: "0 20px", textAlign: "center" }}>
        <div className="side-panel-empty-icon" style={{ marginBottom: "16px", opacity: 0.5 }}>
          <FolderIcon sx={{ fontSize: 40 }} />
        </div>
        <p className="side-panel-empty-text" style={{ fontSize: "13px", color: "#cdd6f4", marginBottom: "8px" }}>
          No Project Opened
        </p>
        <p className="side-panel-empty-sub" style={{ fontSize: "12px", color: "#888", lineHeight: 1.5 }}>
          Open a folder containing a Cargo.toml to start developing.
        </p>
        <button
          className="ide-tab-add"
          style={{
            marginTop: "20px",
            padding: "6px 16px",
            borderRadius: "4px",
            backgroundColor: "var(--ide-teal)",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            fontSize: "12.5px",
            fontWeight: 600,
          }}
          onClick={handleOpenFolder}
        >
          Open Folder
        </button>
      </div>
    );
  }

  if (loading || !tree) {
    return (
      <div className="side-panel-empty">
        <p style={{ color: "#888", fontSize: "12px" }}>Loading files...</p>
      </div>
    );
  }

  return (
    <div className="project-explorer" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        className="pe-header"
        style={{
          padding: "8px 12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: "#1e2227",
          borderBottom: "1px solid #2a2f3b",
        }}
      >
        <span style={{ fontSize: "11px", fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {activeProjectName}
        </span>
        <button
          title="Change Project"
          onClick={handleOpenFolder}
          style={{ background: "transparent", border: "none", color: "#555", cursor: "pointer" }}
        >
          <FolderOpenIcon sx={{ fontSize: 16 }} />
        </button>
      </div>
      <div className="pe-tree-container" style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {tree.children && tree.children.map((child, i) => (
          <TreeNode key={i} node={child} depth={0} />
        ))}
      </div>
    </div>
  );
}

function TreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const { setActiveFile, setContent, addLog, addOpenTab } = useIDEStore();

  const isRust = node.name.endsWith(".rs");
  const isToml = node.name.endsWith(".toml");

  const handleFileClick = async () => {
    if (node.is_dir) {
      setExpanded(!expanded);
    } else {
      try {
        const text = await invoke<string>("read_file_content", { path: node.path });
        setContent(text);
        addOpenTab({ path: node.path, name: node.name });
        setActiveFile(node.path);
      } catch (e) {
        addLog(`[Error] Failed to read ${node.name}`);
      }
    }
  };

  return (
    <div>
      <div
        onClick={handleFileClick}
        style={{
          display: "flex",
          alignItems: "center",
          padding: `4px 12px 4px ${12 + depth * 12}px`,
          cursor: "pointer",
          color: node.is_dir ? "#cdd6f4" : "#9da5b4",
          fontSize: "12px",
          userSelect: "none",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
      >
        <span style={{ marginRight: "6px", display: "flex", alignItems: "center", opacity: node.is_dir ? 0.7 : 1 }}>
          {node.is_dir ? (
            expanded ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : <ChevronRightIcon sx={{ fontSize: 16 }} />
          ) : isRust ? (
            <SettingsApplicationsIcon sx={{ fontSize: 14, color: "#dea54b" }} />
          ) : isToml ? (
            <SettingsApplicationsIcon sx={{ fontSize: 14, color: "#e06c75" }} />
          ) : (
            <InsertDriveFileOutlinedIcon sx={{ fontSize: 14, color: "#5c6370" }} />
          )}
        </span>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {node.name}
        </span>
      </div>
      {node.is_dir && expanded && node.children && (
        <div>
          {node.children.map((child, i) => (
            <TreeNode key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
