use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use toml::Value;

#[derive(Debug, Serialize, Clone)]
pub struct LibraryInfo {
    pub name: String,
    pub version: String,
    pub features: Vec<String>,
}

#[tauri::command]
pub fn get_project_libraries(project_path: String) -> Result<Vec<LibraryInfo>, String> {
    let mut manifest_path = PathBuf::from(&project_path);
    manifest_path.push("Cargo.toml");

    if !manifest_path.exists() {
        return Err("Cargo.toml não encontrado no projeto ativo.".to_string());
    }

    let content = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let parsed: Value = toml::from_str(&content).map_err(|e| format!("Syntax failure in Cargo.toml: {}", e))?;

    let mut libraries = Vec::new();

    if let Some(deps) = parsed.get("dependencies").and_then(|d| d.as_table()) {
        for (name, val) in deps {
            let mut version = "*".to_string();
            let mut features = Vec::new();

            match val {
                Value::String(s) => {
                    version = s.to_string();
                }
                Value::Table(t) => {
                    if let Some(Value::String(v)) = t.get("version") {
                        version = v.to_string();
                    }
                    if let Some(Value::Array(f)) = t.get("features") {
                        for feat in f {
                            if let Value::String(s) = feat {
                                features.push(s.to_string());
                            }
                        }
                    }
                }
                _ => {} // Other syntaxes ignored for simplicity
            }

            libraries.push(LibraryInfo {
                name: name.to_string(),
                version,
                features,
            });
        }
    }

    Ok(libraries)
}

#[tauri::command]
pub async fn add_library_to_project(
    project_path: String,
    lib_name: String,
    version: Option<String>,
    features: Option<Vec<String>>,
) -> Result<(), String> {
    let mut cmd = Command::new("cargo");
    cmd.current_dir(&project_path).arg("add");

    let mut pkg_str = lib_name.clone();
    if let Some(v) = version {
        pkg_str.push_str(&format!("@{}", v));
    }
    cmd.arg(pkg_str);

    if let Some(feats) = features {
        if !feats.is_empty() {
            cmd.arg("--features").arg(feats.join(","));
        }
    }

    let output = cmd.output().map_err(|e| e.to_string())?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(err);
    }

    Ok(())
}

#[tauri::command]
pub async fn remove_library_from_project(project_path: String, lib_name: String) -> Result<(), String> {
    let output = Command::new("cargo")
        .current_dir(&project_path)
        .arg("remove")
        .arg(&lib_name)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(err);
    }

    Ok(())
}
