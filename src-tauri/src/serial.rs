use serialport::SerialPort;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::thread;
use tauri::{AppHandle, Emitter, State};

pub struct SerialState {
    pub port: Arc<Mutex<Option<Box<dyn SerialPort>>>>,
    pub active: Arc<Mutex<bool>>,
}

#[derive(Clone, serde::Serialize)]
struct SerialMessage {
    line: String,
    stream: String, // "stdout" or "stdout" for compat, actually just "plain" in frontend
}

#[tauri::command]
pub fn start_serial(
    app: AppHandle,
    state: State<'_, SerialState>,
    port_name: String,
    baud_rate: u32,
) -> Result<String, String> {
    // Determine if we need to close an existing one
    stop_serial(state.clone())?;

    let port_builder = serialport::new(&port_name, baud_rate)
        .timeout(Duration::from_millis(50));

    let mut port = match port_builder.open() {
        Ok(p) => p,
        Err(e) => return Err(format!("Failed to open serial port {}: {}", port_name, e)),
    };

    // clone the port for reading. `try_clone()` is supported by serialport on most platforms
    let port_clone = match port.try_clone() {
        Ok(c) => c,
        Err(e) => return Err(format!("Failed to clone port for reading: {}", e)),
    };

    {
        let mut p = state.port.lock().unwrap();
        *p = Some(port);
        let mut active = state.active.lock().unwrap();
        *active = true;
    }

    let active_flag = state.active.clone();
    let app_handle = app.clone();

    // Spawn a thread to read continuously
    thread::spawn(move || {
        let mut reader = port_clone;
        let mut byte_buf: Vec<u8> = vec![0; 256];
        let mut line_acc: Vec<u8> = Vec::new();

        loop {
            if !*active_flag.lock().unwrap() {
                break;
            }
            match reader.read(byte_buf.as_mut_slice()) {
                Ok(n) if n > 0 => {
                    // Accumulate bytes into a line buffer
                    for &b in &byte_buf[..n] {
                        if b == b'\n' {
                            // Emit the completed line (strip trailing \r if present)
                            let mut line = String::from_utf8_lossy(&line_acc).to_string();
                            line = line.trim_end_matches('\r').to_string();
                            if !line.is_empty() {
                                let _ = app_handle.emit("ide-serial-log", SerialMessage {
                                    line,
                                    stream: "plain".to_string(),
                                });
                            }
                            line_acc.clear();
                        } else {
                            line_acc.push(b);
                        }
                    }
                }
                Ok(_) => {}
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    // Flush partial line if nothing received for a while
                    // (keep accumulating, timeout is short at 50ms)
                }
                Err(_) => {
                    let _ = app_handle.emit("ide-serial-log", SerialMessage {
                        line: "[Port disconnected]".to_string(),
                        stream: "plain".to_string(),
                    });
                    break;
                }
            }
        }
    });

    Ok(format!("Connected to {} at {} baud.", port_name, baud_rate))
}

#[tauri::command]
pub fn stop_serial(state: State<'_, SerialState>) -> Result<(), String> {
    let mut active = state.active.lock().unwrap();
    *active = false;

    let mut pt = state.port.lock().unwrap();
    if let Some(_p) = pt.take() {
        // dropping it closes the port
    }

    Ok(())
}

#[tauri::command]
pub fn send_serial(state: State<'_, SerialState>, data: String) -> Result<(), String> {
    let mut pt = state.port.lock().unwrap();
    if let Some(port) = pt.as_mut() {
        // Append \r\n if needed, or assume frontend formats it
        match port.write(data.as_bytes()) {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Failed to write to port: {}", e)),
        }
    } else {
        Err("Serial port is not connected.".to_string())
    }
}
