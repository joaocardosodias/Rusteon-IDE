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

/// Options passed to `esp-generate` for Espressif targets (headless mode).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EspGenerateOptions {
    #[serde(default)]
    pub embassy: bool,
    #[serde(default)]
    pub alloc: bool,
    #[serde(default)]
    pub wifi: bool,
    #[serde(default)]
    pub ble: bool,
    /// `-o esp-backtrace`
    #[serde(default = "default_esp_backtrace")]
    pub esp_backtrace: bool,
    /// `-o log`
    #[serde(default)]
    pub log: bool,
}

fn default_esp_backtrace() -> bool {
    true
}

impl Default for EspGenerateOptions {
    fn default() -> Self {
        Self {
            embassy: false,
            alloc: false,
            wifi: false,
            ble: false,
            esp_backtrace: true,
            log: false,
        }
    }
}

/// Options for `cargo generate` (STM32 / RP2040 templates).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CargoGenerateOptions {
    /// `embassy` | `stm32Hal` | `rp2040Official`
    pub template_kind: String,
    #[serde(default)]
    pub chip: Option<String>,
    #[serde(default)]
    pub stm32_hal_version: Option<String>,
    #[serde(default)]
    pub rtic: bool,
    #[serde(default)]
    pub defmt: bool,
    #[serde(default)]
    pub svd: bool,
    #[serde(default)]
    pub flash_method: Option<String>,
}

const GIT_EMBASSY_TEMPLATE: &str = "https://github.com/lulf/embassy-template";
const GIT_STM32_HAL_TEMPLATE: &str = "https://github.com/burrbull/stm32-template";
const GIT_RP2040_TEMPLATE: &str = "https://github.com/rp-rs/rp2040-project-template";

fn default_embassy_chip_for_board(board_id: &str) -> &'static str {
    match board_id {
        "rp2040" => "rp2040",
        "stm32f4" => "stm32f407vg",
        _ => "rp2040",
    }
}

fn run_cargo_generate(
    parent_path: &Path,
    project_name: &str,
    git_url: &str,
    defines: &[(&str, String)],
) -> Result<(), String> {
    let mut cmd = Command::new("cargo");
    cmd.arg("generate")
        .arg("--git")
        .arg(git_url)
        .arg("--name")
        .arg(project_name)
        .arg("--destination")
        .arg(parent_path)
        .arg("--force-git-init")
        .arg("--allow-commands");

    for (key, value) in defines {
        cmd.arg("-d").arg(format!("{}={}", key, value));
    }

    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "cargo-generate not available. Install with: cargo install cargo-generate --locked".to_string()
        } else {
            format!("Failed to run cargo generate: {}", e)
        }
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "cargo generate failed (exit code {:?}):\n{}\n{}",
            output.status.code(),
            stdout.trim_end(),
            stderr.trim_end()
        ));
    }

    Ok(())
}

fn run_embedded_cargo_generate(
    parent_path: &Path,
    project_name: &str,
    board_id: &str,
    opts: &CargoGenerateOptions,
) -> Result<(), String> {
    match opts.template_kind.as_str() {
        "embassy" => {
            let chip = opts
                .chip
                .clone()
                .unwrap_or_else(|| default_embassy_chip_for_board(board_id).to_string());
            let defines = vec![("chip", chip)];
            run_cargo_generate(parent_path, project_name, GIT_EMBASSY_TEMPLATE, &defines)?;
        }
        "stm32Hal" => {
            let chip = opts
                .chip
                .clone()
                .unwrap_or_else(|| "stm32f407vg".to_string());
            let version = opts
                .stm32_hal_version
                .clone()
                .unwrap_or_else(|| "last-release".to_string());
            if version != "last-release" && version != "git" {
                return Err(format!(
                    "stm32 HAL version must be 'last-release' or 'git', got: {}",
                    version
                ));
            }
            let defines = vec![
                ("chip", chip),
                ("version", version),
                ("rtic", opts.rtic.to_string()),
                ("defmt_enabled", opts.defmt.to_string()),
                ("svd", opts.svd.to_string()),
            ];
            run_cargo_generate(
                parent_path,
                project_name,
                GIT_STM32_HAL_TEMPLATE,
                &defines,
            )?;
        }
        "rp2040Official" => {
            let flash = opts
                .flash_method
                .clone()
                .unwrap_or_else(|| "probe-rs".to_string());
            let allowed = ["probe-rs", "picotool", "custom", "none"];
            if !allowed.contains(&flash.as_str()) {
                return Err(format!(
                    "flash_method must be one of {:?}, got: {}",
                    allowed, flash
                ));
            }
            let defines = vec![("flash_method", flash)];
            run_cargo_generate(parent_path, project_name, GIT_RP2040_TEMPLATE, &defines)?;
        }
        other => {
            return Err(format!(
                "Unknown cargo-generate template kind: {} (expected embassy | stm32Hal | rp2040Official)",
                other
            ));
        }
    }
    Ok(())
}

fn is_espressif_template(template: &str) -> bool {
    matches!(
        template,
        "esp32" | "esp32c2" | "esp32c3" | "esp32c6" | "esp32h2" | "esp32s2" | "esp32s3"
    )
}

fn run_esp_generate(
    parent_path: &Path,
    project_name: &str,
    chip: &str,
    opts: &EspGenerateOptions,
) -> Result<(), String> {
    // esp-generate constraints (see `esp-generate list-options`):
    // - embassy, wifi, ble-bleps require -o unstable-hal
    // - wifi, ble-bleps require -o alloc
    let needs_unstable_hal = opts.embassy || opts.wifi || opts.ble;
    let needs_alloc = opts.alloc || opts.wifi || opts.ble;

    let mut cmd = Command::new("esp-generate");
    cmd.arg("--chip")
        .arg(chip)
        .arg("--headless")
        .arg("-O")
        .arg(parent_path)
        .arg("--skip-update-check");

    if needs_unstable_hal {
        cmd.args(["-o", "unstable-hal"]);
    }
    if needs_alloc {
        cmd.args(["-o", "alloc"]);
    }
    if opts.embassy {
        cmd.args(["-o", "embassy"]);
    }
    if opts.wifi {
        cmd.args(["-o", "wifi"]);
    }
    if opts.ble {
        cmd.args(["-o", "ble-bleps"]);
    }
    if opts.esp_backtrace {
        cmd.args(["-o", "esp-backtrace"]);
    }
    if opts.log {
        cmd.args(["-o", "log"]);
    }

    cmd.arg(project_name);

    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "esp-generate not found on PATH. Install with: cargo install esp-generate --locked"
                .to_string()
        } else {
            format!("Failed to run esp-generate: {}", e)
        }
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "esp-generate failed (exit code {:?}):\n{}\n{}",
            output.status.code(),
            stdout.trim_end(),
            stderr.trim_end()
        ));
    }

    Ok(())
}

use tauri::Manager;

#[tauri::command]
pub fn create_new_project(
    _app: tauri::AppHandle,
    name: String,
    parent_dir: String,
    template: String,
    esp_options: Option<EspGenerateOptions>,
    cargo_generate_options: Option<CargoGenerateOptions>,
) -> Result<String, String> {
    let parent_path = PathBuf::from(&parent_dir);
    if !parent_path.exists() {
        return Err(format!("Destination folder does not exist: {}", parent_dir));
    }

    let project_path = parent_path.join(&name);
    if project_path.exists() {
        return Err(format!(
            "A folder named '{}' already exists in that location.",
            name
        ));
    }

    if template == "standard" {
        run_cargo_new(&parent_path, &name)?;
        return Ok(project_path.to_string_lossy().to_string());
    }

    if is_espressif_template(&template) {
        let opts = esp_options.unwrap_or_default();
        run_esp_generate(&parent_path, &name, &template, &opts)?;
        return Ok(project_path.to_string_lossy().to_string());
    }

    let cg = cargo_generate_options
        .ok_or_else(|| "cargo generate options are required for this board.".to_string())?;
    run_embedded_cargo_generate(&parent_path, &name, template.as_str(), &cg)?;

    Ok(project_path.to_string_lossy().to_string())
}

fn run_cargo_new(parent_path: &Path, name: &str) -> Result<(), String> {
    let output = Command::new("cargo")
        .arg("new")
        .arg(name)
        .arg("--bin")
        .current_dir(parent_path)
        .output()
        .map_err(|e| format!("Failed to invoke cargo new: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "cargo new failed. std_err: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
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

    // Fallback: Infer from Cargo.toml dependencies (esp-hal, embassy-rp, etc.)
    let cargo_path = Path::new(&project_path).join("Cargo.toml");
    if cargo_path.exists() {
        if let Ok(content) = fs::read_to_string(&cargo_path) {
            if let Ok(doc) = content.parse::<toml_edit::DocumentMut>() {
                if let Some(deps) = doc.get("dependencies").and_then(|i| i.as_table()) {
                    // Raspberry Pi Pico (RP2040)
                    if deps.contains_key("rp2040-hal") || deps.contains_key("embassy-rp") || deps.contains_key("rp-pico") || deps.contains_key("rp2040-pac") {
                        return Ok(Some("thumbv6m-none-eabi".to_string()));
                    }
                    
                    // ESP Series inference from esp-hal
                    if let Some(esp_hal) = deps.get("esp-hal") {
                        let features_str = esp_hal.to_string();
                        if features_str.contains("\"esp32\"") {
                            return Ok(Some("xtensa-esp32-none-elf".to_string()));
                        } else if features_str.contains("\"esp32s2\"") {
                            return Ok(Some("xtensa-esp32s2-none-elf".to_string()));
                        } else if features_str.contains("\"esp32s3\"") {
                            return Ok(Some("xtensa-esp32s3-none-elf".to_string()));
                        } else if features_str.contains("\"esp32c3\"") {
                            return Ok(Some("riscv32imc-unknown-none-elf".to_string()));
                        } else if features_str.contains("\"esp32c6\"") {
                            return Ok(Some("riscv32imac-unknown-none-elf".to_string()));
                        }
                    }
                }
            }
        }
    }

    Ok(None)
}

#[tauri::command]
pub fn update_cargo_target(project_path: String, new_target: String) -> Result<(), String> {
    let config_path = Path::new(&project_path).join(".cargo").join("config.toml");
    if !config_path.exists() {
        return Err(".cargo/config.toml not found in the project.".to_string());
    }

    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let mut doc = content.parse::<toml_edit::DocumentMut>().map_err(|e| e.to_string())?;

    {
        // Ensure [build] exists
        let build = doc.entry("build").or_insert(toml_edit::Item::Table(toml_edit::Table::new()));
        
        if let Some(build_table) = build.as_table_mut() {
            build_table.insert("target", toml_edit::value(new_target));
        } else {
            return Err("Malformed [build] section in config.toml.".to_string());
        }
    }

    fs::write(&config_path, doc.to_string()).map_err(|e| e.to_string())?;
    Ok(())
}
