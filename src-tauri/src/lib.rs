// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn build_project() -> String {
    "Building... (Rust Stub)".into()
}

#[tauri::command]
fn flash_firmware() -> String {
    "Flashing... (Rust Stub)".into()
}

#[tauri::command]
fn get_serial_ports() -> Result<Vec<String>, String> {
    match serialport::available_ports() {
        Ok(ports) => {
            // Filtrar apenas portas USB (dispositivos conectados)
            let port_names: Vec<String> = ports
                .iter()
                .filter(|p| {
                    // Incluir apenas portas USB (Arduino, ESP32, etc.)
                    matches!(p.port_type, serialport::SerialPortType::UsbPort(_))
                })
                .map(|p| p.port_name.clone())
                .collect();
            Ok(port_names)
        }
        Err(e) => Err(format!("Erro ao obter portas seriais: {}", e))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, build_project, flash_firmware, get_serial_ports])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
