use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub struct DebuggerState {
    pub process: Mutex<Option<Child>>,
    pub port: Mutex<Option<u16>>,
    pub tcp_stream: Mutex<Option<TcpStream>>,
}

impl Default for DebuggerState {
    fn default() -> Self {
        Self {
            process: Mutex::new(None),
            port: Mutex::new(None),
            tcp_stream: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub fn check_probers_installed() -> bool {
    Command::new("probe-rs")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[tauri::command]
pub fn install_probers() -> Result<String, String> {
    // 1. Try cargo binstall (fast, precompiled)
    let binstall_output = Command::new("cargo")
        .args(["binstall", "--version"])
        .output();

    let success = if let Ok(out) = binstall_output {
        if out.status.success() {
            let res = Command::new("cargo")
                .args(["binstall", "probe-rs-tools", "-y"])
                .output();
            res.map(|o| o.status.success()).unwrap_or(false)
        } else { false }
    } else { false };

    if success {
        return Ok("probe-rs installed via binstall".to_string());
    }

    // 2. Fallback to cargo install (slow, compiles from source)
    let output = Command::new("cargo")
        .args(["install", "probe-rs-tools"])
        .output()
        .map_err(|e| format!("Failed to spawn cargo install: {}", e))?;

    if output.status.success() {
        Ok("probe-rs installed via cargo install (this was slow!)".to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

/// Returns the cargo build target from the project's .cargo/config.toml
/// e.g. "xtensa-esp32-none-elf", "riscv32imc-unknown-none-elf", "thumbv7em-none-eabihf"
/// Returns "unknown" if not found.
#[tauri::command]
pub fn get_project_target(project_path: String) -> String {
    let config_path = std::path::Path::new(&project_path).join(".cargo/config.toml");
    let content = match std::fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return "unknown".to_string(),
    };

    // Parse [build] section, finding: target = "..."
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with("target") && line.contains('=') {
            let parts: Vec<&str> = line.splitn(2, '=').collect();
            if parts.len() == 2 {
                return parts[1].trim().trim_matches('"').to_string();
            }
        }
    }
    "unknown".to_string()
}

// Struct just to parse the cargo json message
#[derive(serde::Deserialize)]
struct CargoMessage {
    reason: Option<String>,
    executable: Option<String>,
}

#[tauri::command]
pub async fn build_for_debug(project_path: String, app: AppHandle) -> Result<String, String> {
    // Detect xtensa target for toolchain selection
    let cargo_config = std::path::Path::new(&project_path).join(".cargo/config.toml");
    let is_xtensa = std::fs::read_to_string(&cargo_config)
        .ok()
        .and_then(|c| {
            c.lines()
                .find(|l| l.trim_start().starts_with("target") && l.contains('='))
                .and_then(|l| l.split('=').nth(1))
                .map(|s| s.trim().trim_matches('"').to_string())
        })
        .map(|t| t.starts_with("xtensa"))
        .unwrap_or(false);

    let env_strip = [
        "RUSTUP_TOOLCHAIN", "RUSTC", "RUSTDOC", "RUSTC_WRAPPER",
        "RUSTFLAGS", "CARGO", "CARGO_MAKEFLAGS", "CARGO_HOME",
    ];

    let mut cmd = Command::new("cargo");
    if is_xtensa { cmd.arg("+esp"); }
    cmd.arg("build").arg("--message-format=json");
    for var in &env_strip { cmd.env_remove(var); }
    if let Ok(home) = std::env::var("HOME") {
        let cargo_home = format!("{home}/.cargo");
        if std::path::Path::new(&cargo_home).exists() {
            cmd.env("CARGO_HOME", cargo_home);
        }
    }
    cmd.current_dir(&project_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn cargo build: {}", e))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let app_clone = app.clone();

    
    // Read stdout which contains the JSON messages from cargo
    let th = std::thread::spawn(move || {
        let mut final_elf = None;
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if let Ok(cargo_msg) = serde_json::from_str::<CargoMessage>(&line) {
                if cargo_msg.reason.as_deref() == Some("compiler-artifact") {
                    if let Some(exe) = cargo_msg.executable {
                        final_elf = Some(exe);
                    }
                }
            }
        }
        final_elf
    });

    // We can also pipe stderr to the ide console if needed
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            let _ = app_clone.emit("ide-build-log", serde_json::json!({
                "line": line,
                "stream": "stderr"
            }));
        }
    });

    let status = child.wait().map_err(|e| e.to_string())?;
    let elf_path = th.join().unwrap_or(None);

    if status.success() {
        if let Some(elf) = elf_path {
            Ok(elf)
        } else {
            Err("Build succeeded but no executable was produced. Are you sure this is a binary crate?".into())
        }
    } else {
        Err("Build failed. Check compilation errors.".into())
    }
}

#[tauri::command]
pub fn start_debug_session(
    app: AppHandle,
    state: State<'_, DebuggerState>,
    project_path: String,
) -> Result<u16, String> {
    // 1. Kill any existing DAP session
    {
        let mut proc_guard = state.process.lock().unwrap();
        if let Some(mut child) = proc_guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *state.port.lock().unwrap() = None;
        *state.tcp_stream.lock().unwrap() = None;
    }

    // Generate a random port between 50000 and 60000
    let port: u16 = 50000 + (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_micros() % 10000) as u16;

    // 2. Spawn probe-rs dap-server
    let child = Command::new("probe-rs")
        .args(["dap-server", "--port", &port.to_string()])
        .current_dir(&project_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start probe-rs dap-server: {}", e))?;

    // Wait a brief moment to allow the server to bind to the port
    std::thread::sleep(std::time::Duration::from_millis(500));

    // Connect TCP stream
    let address = format!("127.0.0.1:{}", port);
    let stream = TcpStream::connect(&address).map_err(|e| format!("Failed to connect to DAP TCP socket: {}", e))?;
    let stream_clone = stream.try_clone().map_err(|e| format!("Failed to clone stream: {}", e))?;
    
    *state.process.lock().unwrap() = Some(child);
    *state.port.lock().unwrap() = Some(port);
    *state.tcp_stream.lock().unwrap() = Some(stream);

    // DAP reading thread
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stream_clone);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => break, // EOF
                Ok(_) => {
                    let text = line.trim();
                    if text.starts_with("Content-Length:") {
                        let len_str = text["Content-Length:".len()..].trim();
                        if let Ok(len) = len_str.parse::<usize>() {
                            // Skip straight to body, reading the \r\n
                            loop {
                                let mut hdr = String::new();
                                if reader.read_line(&mut hdr).is_err() || hdr.trim().is_empty() {
                                    break;
                                }
                            }
                            
                            let mut buf = vec![0; len];
                            if reader.read_exact(&mut buf).is_ok() {
                                if let Ok(json_str) = String::from_utf8(buf) {
                                    let _ = app.emit("dap-rx", json_str);
                                }
                            }
                        }
                    }
                }
                Err(_) => break, // Error / Disconnected
            }
        }
        
        let _ = app.emit("dap-disconnected", ());
    });

    Ok(port)
}

#[tauri::command]
pub fn send_dap_message(state: State<'_, DebuggerState>, message: String) -> Result<(), String> {
    let mut stream_guard = state.tcp_stream.lock().unwrap();
    if let Some(stream) = stream_guard.as_mut() {
        let payload = format!("Content-Length: {}\r\n\r\n{}", message.len(), message);
        stream.write_all(payload.as_bytes()).map_err(|e| e.to_string())?;
        stream.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("DAP TCP stream is not connected".into())
    }
}

#[tauri::command]
pub fn stop_debug_session(state: State<'_, DebuggerState>) -> Result<(), String> {
    let mut proc_guard = state.process.lock().unwrap();
    if let Some(mut child) = proc_guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *state.tcp_stream.lock().unwrap() = None;
    *state.port.lock().unwrap() = None;

    Ok(())
}
