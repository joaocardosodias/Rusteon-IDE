use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager};
pub mod serial;

mod project;
mod library;
mod diagnostics;

mod build_flash;
mod lsp;
mod debugger;
// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum InstallMethod {
    Rustup,
    Espup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BoardInstallState {
    installed_targets: Vec<String>,
    espup_installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedState {
    installed_targets: Vec<String>,
    espup_installed: bool,
    last_check: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstallProgress {
    target: String,
    line: String,
    stream: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstallComplete {
    target: String,
    success: bool,
    message: String,
}

// ─── Config / Log Path Helpers ────────────────────────────────────────────────

fn get_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("rusteon")
}

fn get_log_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("rusteon")
        .join("logs")
}

fn load_persisted_state() -> PersistedState {
    let path = get_config_dir().join("boards.json");
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(PersistedState {
            installed_targets: vec![],
            espup_installed: false,
            last_check: String::new(),
        })
}

fn save_persisted_state(state: &PersistedState) -> Result<(), String> {
    let dir = get_config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Error creating directory: {}", e))?;
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("boards.json"), json).map_err(|e| e.to_string())
}

fn save_install_log(target: &str, content: &str) -> Result<(), String> {
    let dir = get_log_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Error creating logs directory: {}", e))?;
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let filename = format!("{}_{}.log", target.replace('/', "_"), timestamp);
    std::fs::write(dir.join(filename), content).map_err(|e| e.to_string())
}

// ─── Existing Commands ────────────────────────────────────────────────────────

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_serial_ports() -> Result<Vec<String>, String> {
    match serialport::available_ports() {
        Ok(ports) => {
            let port_names: Vec<String> = ports
                .iter()
                .filter(|p| matches!(p.port_type, serialport::SerialPortType::UsbPort(_)))
                .map(|p| p.port_name.clone())
                .collect();
            Ok(port_names)
        }
        Err(e) => Err(format!("Error getting serial ports: {}", e)),
    }
}

// ─── Board Manager Commands ──────────────────────────────────────────────────

#[tauri::command]
fn check_installed_targets() -> Result<BoardInstallState, String> {
    let rustup_output = Command::new("rustup")
        .args(["target", "list", "--installed"])
        .output()
        .map_err(|e| format!("rustup not found: {}", e))?;

    let real_targets: Vec<String> = String::from_utf8_lossy(&rustup_output.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    let espup_installed = Command::new("espup")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    let persisted = load_persisted_state();

    let mut merged = real_targets.clone();
    for t in &persisted.installed_targets {
        if !merged.contains(t) {
            if t.starts_with("xtensa-") && espup_installed {
                merged.push(t.clone());
            }
        }
    }

    let new_persisted = PersistedState {
        installed_targets: merged.clone(),
        espup_installed,
        last_check: chrono::Local::now().to_rfc3339(),
    };
    let _ = save_persisted_state(&new_persisted);

    Ok(BoardInstallState {
        installed_targets: merged,
        espup_installed,
    })
}

#[tauri::command]
async fn install_board_target(
    app: tauri::AppHandle,
    target: String,
    method: InstallMethod,
    espup_targets: Option<String>,
) -> Result<String, String> {
    let current = check_installed_targets()?;
    if current.installed_targets.contains(&target) {
        return Ok(format!("{} is already installed", target));
    }

    let emit_progress = |app: &tauri::AppHandle, line: &str, stream: &str| {
        let _ = app.emit(
            "install-progress",
            InstallProgress {
                target: target.clone(),
                line: line.to_string(),
                stream: stream.to_string(),
            },
        );
    };

    emit_progress(&app, &format!("> Installing target: {}", target), "info");

    let mut log_content = String::new();

    match method {
        InstallMethod::Rustup => {
            emit_progress(&app, &format!("> rustup target add {}", target), "cmd");

            let mut child = Command::new("rustup")
                .args(["target", "add", &target])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to execute rustup: {}", e))?;

            if let Some(stdout) = child.stdout.take() {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    log_content.push_str(&line);
                    log_content.push('\n');
                    emit_progress(&app, &line, "stdout");
                }
            }

            if let Some(stderr) = child.stderr.take() {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    log_content.push_str(&line);
                    log_content.push('\n');
                    emit_progress(&app, &line, "stderr");
                }
            }

            let status = child.wait().map_err(|e| e.to_string())?;

            if !status.success() {
                let _ = save_install_log(&target, &log_content);
                let _ = app.emit(
                    "install-complete",
                    InstallComplete {
                        target: target.clone(),
                        success: false,
                        message: "Installation failed".to_string(),
                    },
                );
                return Err(format!("rustup target add failed with code {}", status));
            }
        }
        InstallMethod::Espup => {
            let mut args = vec!["install".to_string()];
            if let Some(ref targets) = espup_targets {
                args.push("--targets".to_string());
                args.push(targets.clone());
            }

            emit_progress(&app, &format!("> espup {}", args.join(" ")), "cmd");

            let mut child = Command::new("espup")
                .args(&args)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to execute espup: {}. Make sure espup is installed (cargo install espup).", e))?;

            if let Some(stdout) = child.stdout.take() {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    log_content.push_str(&line);
                    log_content.push('\n');
                    emit_progress(&app, &line, "stdout");
                }
            }

            if let Some(stderr) = child.stderr.take() {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    log_content.push_str(&line);
                    log_content.push('\n');
                    emit_progress(&app, &line, "stderr");
                }
            }

            let status = child.wait().map_err(|e| e.to_string())?;

            if !status.success() {
                let _ = save_install_log(&target, &log_content);
                let _ = app.emit(
                    "install-complete",
                    InstallComplete {
                        target: target.clone(),
                        success: false,
                        message: "espup install failed".to_string(),
                    },
                );
                return Err(format!("espup install failed with code {}", status));
            }
        }
    }

    let mut persisted = load_persisted_state();
    if !persisted.installed_targets.contains(&target) {
        persisted.installed_targets.push(target.clone());
    }
    if method == InstallMethod::Espup {
        persisted.espup_installed = true;
    }
    persisted.last_check = chrono::Local::now().to_rfc3339();
    let _ = save_persisted_state(&persisted);

    let _ = save_install_log(&target, &log_content);

    let _ = app.emit(
        "install-complete",
        InstallComplete {
            target: target.clone(),
            success: true,
            message: format!("✓ {} successfully installed", target),
        },
    );

    Ok(format!("✓ {} successfully installed", target))
}

#[tauri::command]
fn remove_board_target(target: String) -> Result<String, String> {
    if target.starts_with("xtensa-") {
        let mut persisted = load_persisted_state();
        persisted.installed_targets.retain(|t| t != &target);
        persisted.last_check = chrono::Local::now().to_rfc3339();
        let _ = save_persisted_state(&persisted);
        return Ok(format!(
            "✓ {} removed from state (Xtensa toolchain maintained)",
            target
        ));
    }

    let output = Command::new("rustup")
        .args(["target", "remove", &target])
        .output()
        .map_err(|e| format!("Failed to execute rustup: {}", e))?;

    if output.status.success() {
        let mut persisted = load_persisted_state();
        persisted.installed_targets.retain(|t| t != &target);
        persisted.last_check = chrono::Local::now().to_rfc3339();
        let _ = save_persisted_state(&persisted);
        Ok(format!("✓ {} removed", target))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

// ─── Tauri Entry ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(build_flash::ProcessState {
                child: std::sync::Mutex::new(None),
            });
            app.manage(serial::SerialState {
                port: std::sync::Arc::new(std::sync::Mutex::new(None)),
                active: std::sync::Arc::new(std::sync::Mutex::new(false)),
            });
            app.manage(lsp::LspState::default());
            app.manage(debugger::DebuggerState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            build_flash::build_project,
            build_flash::flash_firmware,
            build_flash::cancel_process,
            get_serial_ports,
            project::read_dir_recursive,
            project::read_file_content,
            project::save_file,
            project::create_new_project,
            project::save_last_project,
            project::load_last_project,
            library::get_project_libraries,
            library::add_library_to_project,
            library::remove_library_from_project,
            diagnostics::check_project,
            diagnostics::get_crate_features,
            diagnostics::add_feature_to_cargo,
            diagnostics::add_crate_to_cargo,
            check_installed_targets,
            install_board_target,
            remove_board_target,
            serial::start_serial,
            serial::stop_serial,
            serial::send_serial,
            lsp::check_lsp_installed,
            lsp::install_lsp,
            lsp::start_lsp,
            lsp::stop_lsp,
            lsp::send_lsp_message,
            project::detect_cargo_target,
            project::update_cargo_target,
            debugger::check_probers_installed,
            debugger::install_probers,
            debugger::get_project_target,
            debugger::build_for_debug,
            debugger::start_debug_session,
            debugger::send_dap_message,
            debugger::stop_debug_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
