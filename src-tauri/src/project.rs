use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

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

#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize)]
pub struct ProjectTemplate {
    pub id: String,
    pub name: String,
}

use tauri::Manager;

#[tauri::command]
pub fn create_new_project(
    app: tauri::AppHandle,
    name: String,
    parent_dir: String,
    template: String,
) -> Result<String, String> {
    let parent_path = PathBuf::from(&parent_dir);
    if !parent_path.exists() {
        return Err(format!("A pasta destino não existe: {}", parent_dir));
    }

    let project_path = parent_path.join(&name);
    if project_path.exists() {
        return Err(format!("Já existe uma pasta com o nome '{}' nesse local.", name));
    }

    // Pass 1: Run standard `cargo new`
    let output = Command::new("cargo")
        .arg("new")
        .arg(&name)
        .arg("--bin")
        .current_dir(&parent_path)
        .output()
        .map_err(|e| format!("Falha ao invocar cargo new: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Falha no cargo new. std_err: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Pass 2: Apply templates if necessary
    match template.as_str() {
        "standard" => {}
        チップ => apply_esp_template(&app, &project_path, チップ)?,
    }

    Ok(project_path.to_string_lossy().to_string())
}

fn apply_esp_template(app: &tauri::AppHandle, project_path: &PathBuf, chip: &str) -> Result<(), String> {
    let base_res_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    // local testing fallback or resource path
    let mut tpl_dir = base_res_dir.join("templates").join(chip);
    if !tpl_dir.exists() {
        // Fallback for tauri dev where resources might just be in CWD
        tpl_dir = std::env::current_dir().unwrap().join("templates").join(chip);
    }
    
    if !tpl_dir.exists() {
        return Err(format!("Template directory for '{}' not found at {:?}", chip, tpl_dir));
    }

    // 1. Overwrite main.rs
    fs::copy(tpl_dir.join("main.rs"), project_path.join("src").join("main.rs"))
        .map_err(|e| format!("Erro ao copiar main.rs do template: {}", e))?;

    // 2. Intelligent Merge Cargo.toml using toml_edit
    let target_toml = project_path.join("Cargo.toml");
    let target_content = fs::read_to_string(&target_toml).map_err(|e| e.to_string())?;
    let mut target_doc = target_content.parse::<toml_edit::DocumentMut>().map_err(|e| e.to_string())?;

    let source_toml = tpl_dir.join("Cargo.toml");
    if source_toml.exists() {
        let source_content = fs::read_to_string(&source_toml).map_err(|e| e.to_string())?;
        let source_doc = source_content.parse::<toml_edit::DocumentMut>().map_err(|e| e.to_string())?;

        // Smart merge: Add [dependencies] from template without destroying original formatting
        if let Some(deps) = source_doc.get("dependencies") {
            target_doc["dependencies"] = deps.clone();
        }
        
        fs::write(&target_toml, target_doc.to_string()).map_err(|e| e.to_string())?;
    }

    // 3. Copy .cargo/config.toml
    let dot_cargo = project_path.join(".cargo");
    fs::create_dir_all(&dot_cargo).map_err(|e| e.to_string())?;
    fs::copy(tpl_dir.join(".cargo").join("config.toml"), dot_cargo.join("config.toml"))
        .map_err(|e| format!("Erro config.toml: {}", e))?;

    // 4. Copy rust-toolchain.toml (if it exists)
    let tc_path = tpl_dir.join("rust-toolchain.toml");
    if tc_path.exists() {
        fs::copy(&tc_path, project_path.join("rust-toolchain.toml"))
            .map_err(|e| format!("Erro ao copiar rust-toolchain.toml: {}", e))?;
    }

    Ok(())
}

// ── Last Project Persistence ─────────────────────────────────────────────────

fn last_project_file(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("last_project.json")
}

#[derive(Serialize, Deserialize)]
pub struct LastProject {
    pub path: String,
    pub name: String,
}

#[tauri::command]
pub fn save_last_project(app: tauri::AppHandle, path: String, name: String) -> Result<(), String> {
    let file = last_project_file(&app);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).ok();
    }
    let data = LastProject { path, name };
    let json = serde_json::to_string(&data).map_err(|e| e.to_string())?;
    fs::write(file, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_last_project(app: tauri::AppHandle) -> Option<LastProject> {
    let file = last_project_file(&app);
    let content = fs::read_to_string(file).ok()?;
    serde_json::from_str(&content).ok()
}

#[tauri::command]
pub fn detect_cargo_target(project_path: String) -> Result<Option<String>, String> {
    // First try the .cargo/config.toml (standard embedded pattern)
    let config_path = Path::new(&project_path).join(".cargo").join("config.toml");
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(doc) = content.parse::<toml_edit::DocumentMut>() {
                if let Some(build) = doc.get("build").and_then(|i| i.as_table()) {
                    if let Some(target) = build.get("target").and_then(|i| i.as_str()) {
                        return Ok(Some(target.to_string()));
                    }
                }
            }
        }
    }

    Ok(None)
}
