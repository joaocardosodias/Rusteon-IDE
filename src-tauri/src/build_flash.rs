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

/// Build a `cargo` command that is fully isolated from the Tauri/rustup host env.
/// This prevents env vars like RUSTUP_TOOLCHAIN, RUSTC, RUSTDOC, etc. from
/// leaking into the user's embedded project build and causing "Unsupported target" errors.
fn isolated_cargo_cmd(extra_args: &[&str], project_path: &str) -> Command {
    let mut cmd = Command::new("cargo");
    for arg in extra_args {
        cmd.arg(arg);
    }
    // Strip every known Rust/Cargo env var that Tauri's dev runner injects.
    // RUSTUP_TOOLCHAIN is the main culprit but RUSTC/RUSTDOC can also override.
    let strip = [
        "RUSTUP_TOOLCHAIN",
        "RUSTC",
        "RUSTDOC",
        "RUSTC_WRAPPER",
        "RUSTFLAGS",
        "CARGO",
        "CARGO_MAKEFLAGS",
        "CARGO_HOME",  // only strip if dev overrides; rustup will find its own
    ];
    for var in &strip {
        cmd.env_remove(var);
    }
    cmd.current_dir(project_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd
}

#[tauri::command]
pub async fn build_project(
    app: AppHandle,
    state: State<'_, ProcessState>,
    project_path: String,
) -> Result<String, String> {
    cancel_process(state.clone())?;

    // ── Detect target triple intelligently ───────────────────────────────────
    let target_triple: Option<String> = crate::project::detect_cargo_target(project_path.clone())
        .unwrap_or(None);

    let is_xtensa = target_triple
        .as_deref()
        .map(|t| t.starts_with("xtensa"))
        .unwrap_or(false);

    // ── Build the command ─────────────────────────────────────────────────────
    let mut args = Vec::new();
    if is_xtensa {
        args.push("+esp");
    }
    args.push("build");
    args.push("--release");
    args.push("--color=never");

    let target_str = target_triple.clone().unwrap_or_default();
    if !target_str.is_empty() {
        args.push("--target");
        args.push(&target_str);
    }

    let mut cmd = isolated_cargo_cmd(&args, &project_path);
    // Restore CARGO_HOME so the user's own Cargo installation is used.
    if let Ok(home) = std::env::var("HOME") {
        let cargo_home = format!("{home}/.cargo");
        if std::path::Path::new(&cargo_home).exists() {
            cmd.env("CARGO_HOME", cargo_home);
        }
    }

    emit_log(&app, "ide-build-log", format!("> {:?}", cmd), "stdout");

    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn cargo build: {e}"))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    if let Ok(mut guard) = state.child.lock() {
        *guard = Some(child);
    }

    let app1 = app.clone();
    let app2 = app.clone();
    std::thread::spawn(move || {
        BufReader::new(stdout).lines().for_each(|l| {
            if let Ok(line) = l { emit_log(&app1, "ide-build-log", line, "stdout"); }
        });
    });
    std::thread::spawn(move || {
        BufReader::new(stderr).lines().for_each(|l| {
            if let Ok(line) = l { emit_log(&app2, "ide-build-log", line, "stderr"); }
        });
    });

    loop {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let mut guard = state.child.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let ok = status.success();
                    let _ = guard.take();
                    return if ok {
                        Ok("Build finished successfully".into())
                    } else {
                        Err("Build failed".into())
                    };
                }
                Ok(None) => {}
                Err(e) => {
                    let _ = guard.take();
                    return Err(format!("Error waiting for build: {e}"));
                }
            }
        } else {
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
    let target_triple = crate::project::detect_cargo_target(project_path.clone())
        .unwrap_or(None)
        .unwrap_or_default();

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
        c.arg("flash"); // No --monitor: let the process finish cleanly
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
    } else if flash_tool.to_lowercase().contains("elf2uf2") {
        let uf2_path = binary_path.with_extension("uf2");
        let mut c = Command::new("elf2uf2-rs");
        c.arg(&binary_path).arg(&uf2_path);
        c.current_dir(&project_path);
        
        let mut child = match c.spawn() {
            Ok(mut ch) => {
                let _ = ch.wait(); // let it convert directly
                ch
            },
            Err(e) => return Err(format!("Failed to spawn elf2uf2-rs: {}", e)),
        };

        // Custom robust copy to circumvent elf2uf2 -d bugs on Linux/Tauri
        let user = std::env::var("USER").unwrap_or_else(|_| "root".into());
        let possible_mounts = vec![
            format!("/run/media/{}/RPI-RP2", user),
            format!("/media/{}/RPI-RP2", user),
            "/mnt/RPI-RP2".to_string(),
            "/Volumes/RPI-RP2".to_string(), // macOS
        ];

        let mut mounted_path = None;
        for path in possible_mounts {
            if std::path::Path::new(&path).exists() {
                mounted_path = Some(path);
                break;
            }
        }

        if let Some(mnt) = mounted_path {
            let dest = std::path::Path::new(&mnt).join("flash.uf2");
            match std::fs::copy(&uf2_path, &dest) {
                Ok(_) => return Ok("Flash finished successfully (Copied via Rusteon IDE bypass)".into()),
                Err(e) => return Err(format!("Copied UF2 failed: {}", e)),
            }
        } else {
            return Err("Unable to find mounted pico (RPI-RP2 disk not found in /media or /run/media)".into());
        }
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
