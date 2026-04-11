use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub struct LspState {
    pub process: Mutex<Option<Child>>,
    pub stdin: Mutex<Option<ChildStdin>>,
    pub workspace: Mutex<String>,
}

impl Default for LspState {
    fn default() -> Self {
        Self {
            process: Mutex::new(None),
            stdin: Mutex::new(None),
            workspace: Mutex::new(String::new()),
        }
    }
}

#[tauri::command]
pub fn check_lsp_installed() -> bool {
    Command::new("rust-analyzer")
        .arg("--version")
        .env("RUSTUP_TOOLCHAIN", "stable")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[tauri::command]
pub fn install_lsp() -> Result<String, String> {
    let output = Command::new("rustup")
        .args(["component", "add", "rust-analyzer"])
        .output()
        .map_err(|e| format!("Failed to spawn rustup: {}", e))?;

    if output.status.success() {
        Ok("rust-analyzer installed successfully".to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

#[tauri::command]
pub fn stop_lsp(state: State<'_, LspState>) -> Result<(), String> {
    let mut proc_guard = state.process.lock().unwrap();
    if let Some(mut child) = proc_guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    
    let mut stdin_guard = state.stdin.lock().unwrap();
    *stdin_guard = None;

    let mut ws_guard = state.workspace.lock().unwrap();
    ws_guard.clear();

    Ok(())
}

#[tauri::command]
pub fn start_lsp(app: AppHandle, state: State<'_, LspState>, project_path: String) -> Result<(), String> {
    // 1. One LSP per workspace logic
    {
        let ws_guard = state.workspace.lock().unwrap();
        if *ws_guard == project_path {
            return Ok(()); // Already running for this workspace
        }
    }

    // 2. Kill existing if any
    {
        let mut proc_guard = state.process.lock().unwrap();
        if let Some(mut child) = proc_guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let mut stdin_guard = state.stdin.lock().unwrap();
        *stdin_guard = None;
    }

    // 3. Spawn rust-analyzer using the stable toolchain
    // Custom toolchains (like 'esp') don't ship rust-analyzer,
    // so we force RUSTUP_TOOLCHAIN=stable to use the system binary.
    let mut child = Command::new("rust-analyzer")
        .current_dir(&project_path)
        .env("RUSTUP_TOOLCHAIN", "stable")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start rust-analyzer: {}", e))?;

    let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;

    {
        *state.process.lock().unwrap() = Some(child);
        *state.stdin.lock().unwrap() = Some(stdin);
        *state.workspace.lock().unwrap() = project_path.clone();
    }

    // 4. Poll stdout thread
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => break, // EOF, process exited
                Ok(_) => {
                    let text = line.trim();
                    if text.starts_with("Content-Length:") {
                        let len_str = text["Content-Length:".len()..].trim();
                        if let Ok(len) = len_str.parse::<usize>() {
                            // Read remaining headers until empty line "\r\n"
                            loop {
                                let mut hdr = String::new();
                                if reader.read_line(&mut hdr).is_err() || hdr.trim().is_empty() {
                                    break;
                                }
                            }
                            
                            let mut buf = vec![0; len];
                            if reader.read_exact(&mut buf).is_ok() {
                                if let Ok(json_str) = String::from_utf8(buf) {
                                    let _ = app.emit("lsp-rx", json_str);
                                }
                            }
                        }
                    }
                }
                Err(_) => break, // Error reading
            }
        }
        
        // Emitting an automated close event if the loop breaks
        let _ = app.emit("lsp-close", "Process exited");
    });

    Ok(())
}

#[tauri::command]
pub fn send_lsp_message(state: State<'_, LspState>, message: String) -> Result<(), String> {
    let mut stdin_guard = state.stdin.lock().unwrap();
    if let Some(stdin) = stdin_guard.as_mut() {
        let payload = format!("Content-Length: {}\r\n\r\n{}", message.len(), message);
        stdin.write_all(payload.as_bytes()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("LSP is not running".to_string())
    }
}
