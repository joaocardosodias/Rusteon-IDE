import { useState } from "react";
import { useIDEStore } from "../store/useIDEStore";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import { BOARDS } from "../data/boards";

export function ProjectWizard() {
  const { isWizardOpen, setWizardOpen, setActiveProject, addLog, selectedBoard } = useIDEStore();

  const [projectName, setProjectName] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  if (!isWizardOpen) return null;

  const handlePickDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Parent Folder for New Project"
      });
      if (selected && typeof selected === 'string') {
        setParentDir(selected);
        setErrorMsg("");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Transform to standard Rust project naming: lowercase, replace spaces with hyphens
    const val = e.target.value.toLowerCase().replace(/\s+/g, '-');
    setProjectName(val);
  };

  const handleCreate = async () => {
    setErrorMsg("");
    if (!projectName.trim()) {
      setErrorMsg("Project name is required.");
      return;
    }
    if (!parentDir) {
      setErrorMsg("Please select a destination folder.");
      return;
    }
    if (!/^[a-z0-9_-]+$/.test(projectName)) {
      setErrorMsg("Invalid name. Use only lowercase letters, numbers, hyphens, and underscores.");
      return;
    }

    setIsLoading(true);
    try {
      const templateId = selectedBoard || "standard";
      addLog(`Creating new project '${projectName}' via ${templateId}...`);
      
      const newProjectPath = await invoke<string>("create_new_project", {
        name: projectName,
        parentDir: parentDir,
        template: templateId
      });

      addLog(`Project ${projectName} created successfully at ${newProjectPath}`);
      setActiveProject(newProjectPath, projectName);
      
      // Close wizard after success
      handleClose();
    } catch (e) {
      setErrorMsg(String(e));
      addLog(`[Error] Failed to create project: ${e}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setWizardOpen(false);
    setProjectName("");
    setParentDir("");
    setErrorMsg("");
  };

  const boardDef = selectedBoard ? BOARDS.find(b => b.id === selectedBoard) : null;

  // Determine what template tag to show based on system sync
  const syncedTemplateDisplay = boardDef 
    ? `${boardDef.name} (${boardDef.chip})`
    : (selectedBoard || "Standard Rust Binary (No board selected)");

  return (
    <>
      <div className="bm-dialog-overlay" onClick={handleClose} />
      
      <div className="bm-dialog" style={{ width: '450px' }}>
        <div className="bm-dialog-header">
          <h2 className="bm-dialog-title">Create New Project</h2>
          <button className="bm-dialog-close" onClick={handleClose}>
            <CloseOutlinedIcon sx={{ fontSize: 20 }} />
          </button>
        </div>

        <div className="bm-dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Project Name */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', color: 'var(--ide-text-faint)' }}>Project Name</label>
            <input 
              type="text" 
              className="bm-search" 
              placeholder="e.g. my-awesome-firmware"
              value={projectName}
              onChange={handleNameChange}
              style={{ width: '100%', borderRadius: '4px' }}
            />
            {!/^[a-z0-9_-]*$/.test(projectName) && projectName.length > 0 && (
              <div style={{ fontSize: '11px', color: 'var(--danger)' }}>
                Only lowercase, numbers, hyphens, and underscores allowed.
              </div>
            )}
          </div>

          {/* Location */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', color: 'var(--ide-text-faint)' }}>Location</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" 
                className="bm-search" 
                placeholder="Select a folder..."
                value={parentDir}
                readOnly
                style={{ flex: 1, borderRadius: '4px', cursor: 'default', color: 'var(--ide-text)' }}
              />
              <button 
                className="bm-btn-ghost" 
                title="Browse..."
                onClick={handlePickDirectory}
                style={{ 
                  display: 'flex', alignItems: 'center', justifyContent: 'center', 
                  padding: '0 8px', borderRadius: '4px', border: '1px solid var(--ide-border)'
                }}
              >
                <FolderOpenOutlinedIcon sx={{ fontSize: 18, color: 'var(--ide-teal)' }} />
              </button>
            </div>
            {parentDir && projectName && (
              <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
                Will create: {parentDir}/{projectName}
              </div>
            )}
          </div>

          {/* Template Info (Synced) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', color: 'var(--ide-text-faint)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Target Platform</span>
              <span style={{ fontSize: '10px', background: 'var(--ide-teal)', color: '#000', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>AUTO-SYNCED</span>
            </label>
            <div style={{ 
              padding: '8px 12px', 
              background: 'var(--ide-bg-active)', 
              border: '1px solid var(--ide-border)', 
              borderRadius: '4px',
              fontSize: '13px',
              color: 'var(--ide-text)'
            }}>
              {syncedTemplateDisplay}
            </div>
            <div style={{ fontSize: '11px', color: '#666' }}>
              Changes to match the board selected in the bottom status bar.
            </div>
          </div>

          {errorMsg && (
            <div className="bm-error-msg" style={{ 
              marginTop: '8px', 
              background: 'rgba(255, 60, 60, 0.1)', 
              color: 'var(--danger)', 
              padding: '8px 12px', 
              borderRadius: '4px', 
              border: '1px solid rgba(255,60,60,0.3)',
              fontSize: '13px',
              whiteSpace: 'pre-wrap'
            }}>
              {errorMsg}
            </div>
          )}

        </div>

        <div className="bm-dialog-footer" style={{ borderTop: '1px solid var(--ide-border)', padding: '16px', display: 'flex', justifyContent: 'flex-end', gap: '8px', background: 'var(--ide-bg)' }}>
          <button 
            className="bm-btn-ghost" 
            onClick={handleClose}
            disabled={isLoading}
            style={{ padding: '6px 16px', borderRadius: '4px', fontSize: '13px', color: 'var(--ide-text)', border: '1px solid var(--ide-border)' }}
          >
            Cancel
          </button>
          
          <button 
            className="bm-btn" 
            onClick={handleCreate}
            disabled={isLoading || !projectName || !parentDir || !/^[a-z0-9_-]+$/.test(projectName)}
            style={{ 
              padding: '6px 16px', 
              borderRadius: '4px', 
              fontSize: '13px', 
              background: 'var(--ide-teal)',
              color: '#000',
              fontWeight: 500,
              border: 'none',
              cursor: (isLoading || !projectName || !parentDir || !/^[a-z0-9_-]+$/.test(projectName)) ? 'not-allowed' : 'pointer',
              opacity: (isLoading || !projectName || !parentDir || !/^[a-z0-9_-]+$/.test(projectName)) ? 0.5 : 1
            }}
          >
            {isLoading ? "Creating..." : "Create Project"}
          </button>
        </div>
      </div>
    </>
  );
}
