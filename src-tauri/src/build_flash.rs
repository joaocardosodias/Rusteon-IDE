use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub struct ProcessState {
    pub child: Mutex<Option<Child>>,
}

#[derive(Clone, serde::Serialize)]
struct IdeLogMessage {
    line: String,
    stream: String, // "stdout" or "stderr"
}

#[tauri::command]
pub fn cancel_process(state: State<'_, ProcessState>) -> Result<(), String> {
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        // Try to kill the process
        let _ = child.kill();
        let _ = child.wait(); // Clean up zombie
    }
    Ok(())
}

fn emit_log(app: &AppHandle, event_name: &str, line: String, stream: &str) {
    let _ = app.emit(
        event_name,
        IdeLogMessage {
            line,
            stream: stream.to_string(),
        },
    );
}

#[tauri::command]
pub async fn build_project(
    app: AppHandle,
    state: State<'_, ProcessState>,
    project_path: String,
) -> Result<String, String> {
    // 1. Ensure no other process is running
    cancel_process(state.clone())?;

    // 2. Setup the cargo build command
    let mut cmd = Command::new("cargo");
    cmd.arg("build")
        .arg("--release")
        // We use standard textual output, but color=always helps us parse or just color=never
        .arg("--color=never")
        .env_remove("RUSTUP_TOOLCHAIN")
        .env_remove("CARGO")
        .current_dir(&project_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // 3. Spawn the process
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Err(format!("Failed to spawn cargo build: {}", e)),
    };

    // Extract stdout and stderr before storing the child
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    // Store child for cancellation
    if let Ok(mut guard) = state.child.lock() {
        *guard = Some(child);
    }

    let app_clone1 = app.clone();
    let app_clone2 = app.clone();

    // 4. Spawn thread for STDOUT
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(l) = line {
                emit_log(&app_clone1, "ide-build-log", l, "stdout");
            }
        }
    });

    // 5. Spawn thread for STDERR
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(l) = line {
                emit_log(&app_clone2, "ide-build-log", l, "stderr");
            }
        }
    });

    // We can just return success for spawning but we wait for it so the command finishes when the build finishes.
    // Wait, async tauri command doesn't block the UI thread! It runs in a threadpool!
    // So we can wait synchronously.
    
    // Instead of waiting with standard thread sleep, we can just extract the child in a loop or wait for it.
    // However, if we wait for it, we must lock it. But locking it blocks cancel_process.
    // So we will just loop with a lock check over the child.
    
    // Better: We just let it run. But we need to return status.
    // We can pull the child out, run child.wait(), and if someone wants to cancel they can't via mutex easily if we hold it.
    // Trick: sleep loop.
    loop {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let mut guard = state.child.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let s = status.success();
                    let _ = guard.take();
                    if s {
                        return Ok("Build finished successfully".into());
                    } else {
                        return Err("Build failed".into());
                    }
                }
                Ok(None) => {
                    // Still running
                }
                Err(e) => {
                    let _ = guard.take();
                    return Err(format!("Error waiting: {}", e));
                }
            }
        } else {
            // Child was taken by cancel_process!
            return Err("Build cancelled".into());
        }
    }
}

#[tauri::command]
pub async fn flash_firmware(
    app: AppHandle,
    state: State<'_, ProcessState>,
    project_path: String,
    flash_tool: String,
    port: Option<String>,
) -> Result<String, String> {
    cancel_process(state.clone())?;

    // ── Find the binary from cargo metadata ──────────────────────────────────
    // Read .cargo/config.toml to get the target triple
    let cargo_config_path = std::path::Path::new(&project_path)
        .join(".cargo")
        .join("config.toml");

    let target_triple = if cargo_config_path.exists() {
        let config_content = std::fs::read_to_string(&cargo_config_path)
            .unwrap_or_default();
        // Parse `target = "some-triple"` from [build] section
        config_content
            .lines()
            .find(|l| l.trim_start().starts_with("target") && l.contains('='))
            .and_then(|l| l.split('=').nth(1))
            .map(|s| s.trim().trim_matches('"').to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };

    // Read Cargo.toml to extract package name (used as binary name)
    let project_cargo = std::path::Path::new(&project_path).join("Cargo.toml");
    let bin_name = if project_cargo.exists() {
        let content = std::fs::read_to_string(&project_cargo).unwrap_or_default();
        content
            .lines()
            .find(|l| l.trim_start().starts_with("name") && l.contains('='))
            .and_then(|l| l.split('=').nth(1))
            .map(|s| s.trim().trim_matches('"').to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };

    // Compose path: <project>/target/<triple>/release/<bin>
    let binary_path = std::path::Path::new(&project_path)
        .join("target")
        .join(&target_triple)
        .join("release")
        .join(&bin_name);

    if !binary_path.exists() {
        return Err(format!(
            "Binary not found at {:?}. Run Build first.",
            binary_path
        ));
    }

    let mut actual_cmd = if flash_tool.to_lowercase().contains("espflash") {
        let mut c = Command::new("espflash");
        c.arg("flash").arg("--monitor");
        if let Some(ref p) = port {
            if p.to_lowercase() != "auto" && !p.is_empty() {
                c.arg("--port").arg(p);
            }
        }
        // Pass the binary path explicitly — required by espflash 3.x
        c.arg(&binary_path);
        c.current_dir(&project_path);
        c
    } else if flash_tool.to_lowercase().contains("probe-rs") {
        let mut c = Command::new("probe-rs");
        c.arg("run").arg(&binary_path);
        c.current_dir(&project_path);
        c
    } else {
        // Generic cargo run fallback
        let mut c = Command::new("cargo");
        c.arg("run").arg("--release").current_dir(&project_path);
        c
    };

    actual_cmd.env_remove("RUSTUP_TOOLCHAIN").env_remove("CARGO");
    actual_cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = match actual_cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Err(format!("Failed to spawn flash command: {}", e)),
    };

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    if let Ok(mut guard) = state.child.lock() {
        *guard = Some(child);
    }

    let app_clone1 = app.clone();
    let app_clone2 = app.clone();

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(l) = line {
                emit_log(&app_clone1, "ide-flash-log", l, "stdout");
            }
        }
    });

    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(l) = line {
                emit_log(&app_clone2, "ide-flash-log", l, "stderr");
            }
        }
    });

    // Wait loop
    loop {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let mut guard = state.child.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let s = status.success();
                    let _ = guard.take();
                    if s {
                        return Ok("Flash finished successfully".into());
                    } else {
                        return Err("Flash failed".into());
                    }
                }
                Ok(None) => {}
                Err(e) => {
                    let _ = guard.take();
                    return Err(format!("Error waiting: {}", e));
                }
            }
        } else {
            return Err("Flash cancelled".into());
        }
    }
}
