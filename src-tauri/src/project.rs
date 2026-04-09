use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
}

#[tauri::command]
pub fn read_dir_recursive(path: String) -> Result<FileNode, String> {
    let root = Path::new(&path);
    if !root.exists() {
        return Err("Directory does not exist".to_string());
    }
    
    build_tree(root).map_err(|e| e.to_string())
}

fn build_tree(path: &Path) -> std::io::Result<FileNode> {
    let name = path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
        
    let is_dir = path.is_dir();
    let abs_path = path.to_string_lossy().to_string();
    
    let mut node = FileNode {
        name,
        path: abs_path,
        is_dir,
        children: None,
    };
    
    if is_dir {
        let mut children = Vec::new();
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let child_path = entry.path();
            
            // Ingore target and .git to avoid recursive hell and memory blowup
            if let Some(file_name) = child_path.file_name() {
                let name_str = file_name.to_string_lossy();
                if name_str == "target" || name_str == ".git" {
                    continue;
                }
            }
            
            if let Ok(child_node) = build_tree(&child_path) {
                children.push(child_node);
            }
        }
        
        // Sort rules: folders first, then alphabetically
        children.sort_by(|a, b| {
            b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
        });
        
        node.children = Some(children);
    }
    
    Ok(node)
}

#[tauri::command]
pub fn read_file_content(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}
