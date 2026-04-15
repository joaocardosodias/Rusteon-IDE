use serde::{Deserialize, Serialize};
use std::process::Command;
use std::fs;
use std::path::PathBuf;
use toml_edit::{DocumentMut, value};

#[derive(Debug, Clone, Serialize)]
pub struct FeatureDiagnostic {
    pub crate_name: String,
    pub missing_feature: String,
    pub file: String,
    pub line: u32,
    pub help: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StandardDiagnostic {
    pub level: String,
    pub message: String,
    pub file: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct CheckResult {
    pub features: Vec<FeatureDiagnostic>,
    pub errors: Vec<StandardDiagnostic>,
}

#[tauri::command]
pub async fn check_project(project_path: String) -> Result<CheckResult, String> {
    let mut cmd = Command::new("cargo");
    cmd.current_dir(&project_path)
       .arg("check")
       .arg("--message-format=json")
       .env_remove("RUSTUP_TOOLCHAIN")
       .env_remove("CARGO");

    let output = cmd.output().map_err(|e| format!("Failed to spawn cargo check: {}", e))?;
    // We don't care if output status is success or failure, we want to parse the JSON stdout
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut feature_diagnostics = Vec::new();
    let mut standard_errors = Vec::new();

    // Check for build script errors (missing chip features or logging features) which go to stderr
    if let Some(diag) = parse_build_script_feature_error(&stderr, &project_path) {
        feature_diagnostics.push(diag);
    }

    for line in stdout.lines() {
        if line.trim().is_empty() || !line.starts_with('{') {
            continue;
        }

        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            if json.get("reason").and_then(|r| r.as_str()) == Some("compiler-message") {
                if let Some(msg) = json.get("message") {
                    let level = msg.get("level").and_then(|l| l.as_str()).unwrap_or("");
                    // Feature specific matching cases...
                    let mut matched_feature_case = false;
                    
                    if level == "error" || level == "warning" {
                        if let Some(children) = msg.get("children").and_then(|c| c.as_array()) {
                            for child in children {
                                let child_level = child.get("level").and_then(|l| l.as_str()).unwrap_or("");
                                let child_msg = child.get("message").and_then(|m| m.as_str()).unwrap_or("");
                                
                                // Case 1: "consider adding `feature = \"foo\"` to the Cargo.toml"
                                if child_level == "help" {
                                    if let Some(feature_name) = extract_feature_name(child_msg) {
                                        let crate_name = extract_crate_name(child_msg);
                                        
                                        let mut file = String::new();
                                        let mut line_num = 0;
                                        if let Some(spans) = msg.get("spans").and_then(|s| s.as_array()) {
                                            if let Some(primary_span) = spans.iter().find(|s| s.get("is_primary").and_then(|b| b.as_bool()).unwrap_or(false)) {
                                                file = primary_span.get("file_name").and_then(|s| s.as_str()).unwrap_or("").to_string();
                                                line_num = primary_span.get("line_start").and_then(|n| n.as_u64()).unwrap_or(0) as u32;
                                            }
                                        }

                                        feature_diagnostics.push(FeatureDiagnostic {
                                            crate_name: crate_name.unwrap_or_else(|| "unknown".to_string()),
                                            missing_feature: feature_name.to_string(),
                                            file,
                                            line: line_num,
                                            help: child_msg.to_string(),
                                        });
                                        matched_feature_case = true;
                                    }
                                }
                                
                                // Case 2: "found an item that was configured out"
                                if child_level == "note" && child_msg.contains("configured out") {
                                    if let Some(spans) = child.get("spans").and_then(|s| s.as_array()) {
                                        for span in spans {
                                            if let Some(label) = span.get("label").and_then(|l| l.as_str()) {
                                                if label.contains("gated behind the") {
                                                    if let Some(feature_name) = extract_gated_feature(label) {
                                                        let file_name = span.get("file_name").and_then(|f| f.as_str()).unwrap_or("");
                                                        let crate_name = extract_crate_from_path(file_name);
                                                        
                                                        let mut file = String::new();
                                                        let mut line_num = 0;
                                                        if let Some(parent_spans) = msg.get("spans").and_then(|s| s.as_array()) {
                                                            if let Some(primary_span) = parent_spans.iter().find(|s| s.get("is_primary").and_then(|b| b.as_bool()).unwrap_or(false)) {
                                                                file = primary_span.get("file_name").and_then(|s| s.as_str()).unwrap_or("").to_string();
                                                                line_num = primary_span.get("line_start").and_then(|n| n.as_u64()).unwrap_or(0) as u32;
                                                            }
                                                        }
                                                        
                                                        feature_diagnostics.push(FeatureDiagnostic {
                                                            crate_name: crate_name.unwrap_or_else(|| "unknown".to_string()),
                                                            missing_feature: feature_name.to_string(),
                                                            file,
                                                            line: line_num,
                                                            help: label.to_string(),
                                                        });
                                                        matched_feature_case = true;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                // Case 3: "Missing Crate"
                                if child_level == "help" && child_msg.contains("use `cargo add") {
                                    if let Some(crate_name) = extract_missing_crate(child_msg) {
                                        let mut file = String::new();
                                        let mut line_num = 0;
                                        if let Some(spans) = msg.get("spans").and_then(|s| s.as_array()) {
                                            if let Some(primary_span) = spans.iter().find(|s| s.get("is_primary").and_then(|b| b.as_bool()).unwrap_or(false)) {
                                                file = primary_span.get("file_name").and_then(|s| s.as_str()).unwrap_or("").to_string();
                                                line_num = primary_span.get("line_start").and_then(|n| n.as_u64()).unwrap_or(0) as u32;
                                            }
                                        }
                                        feature_diagnostics.push(FeatureDiagnostic {
                                            crate_name: crate_name.replace('_', "-"),
                                            missing_feature: "".to_string(),
                                            file,
                                            line: line_num,
                                            help: child_msg.to_string(),
                                        });
                                        matched_feature_case = true;
                                    }
                                }
                            }
                        }

                        // Case 4: No children help, but span label says "no external crate `xyz`"
                        if let Some(spans) = msg.get("spans").and_then(|s| s.as_array()) {
                            for span in spans {
                                if let Some(label) = span.get("label").and_then(|l| l.as_str()) {
                                    if label.starts_with("no external crate `") {
                                        if let Some(end) = label[19..].find('`') {
                                            let mut crate_name = label[19..19 + end].to_string();
                                            crate_name = crate_name.replace('_', "-");
                                            
                                            let file = span.get("file_name").and_then(|s| s.as_str()).unwrap_or("").to_string();
                                            let line_num = span.get("line_start").and_then(|n| n.as_u64()).unwrap_or(0) as u32;

                                            feature_diagnostics.push(FeatureDiagnostic {
                                                crate_name,
                                                missing_feature: "".to_string(),
                                                file,
                                                line: line_num,
                                                help: label.to_string(),
                                            });
                                            matched_feature_case = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    // Case 5: Panic handler missing
                    if let Some(msg_txt) = msg.get("message").and_then(|m| m.as_str()) {
                        if msg_txt == "`#[panic_handler]` function required, but not found" {
                            if let Some(crate_name) = detect_crate_for_panic_handler(&project_path) {
                                feature_diagnostics.push(FeatureDiagnostic {
                                    crate_name,
                                    missing_feature: "panic-handler".to_string(),
                                    file: "main.rs".to_string(),
                                    line: 0,
                                    help: "A #[panic_handler] is required for #![no_std]. Add the `panic-handler` feature to your backtrace crate.".to_string(),
                                });
                                matched_feature_case = true;
                            }
                        }
                    }
                    
                    // Standard Error Fallback - If it wasn't caught by feature diagnostics
                    // and it's an error/warning, extract generic problem
                    if !matched_feature_case && (level == "error" || level == "warning") {
                        if let Some(msg_txt) = msg.get("message").and_then(|m| m.as_str()) {
                            // Extract primary span
                            let mut file = String::new();
                            let mut line_num = 0;
                            let mut column_num = 0;
                            
                            if let Some(spans) = msg.get("spans").and_then(|s| s.as_array()) {
                                if let Some(primary_span) = spans.iter().find(|s| s.get("is_primary").and_then(|b| b.as_bool()).unwrap_or(false)) {
                                    file = primary_span.get("file_name").and_then(|s| s.as_str()).unwrap_or("").to_string();
                                    line_num = primary_span.get("line_start").and_then(|n| n.as_u64()).unwrap_or(0) as u32;
                                    column_num = primary_span.get("column_start").and_then(|n| n.as_u64()).unwrap_or(0) as u32;
                                }
                            }
                            
                            // Prevent spam from unused warnings if user just wants syntax errors, but warnings are good
                            standard_errors.push(StandardDiagnostic {
                                level: level.to_string(),
                                message: msg_txt.to_string(),
                                file,
                                line: line_num,
                                column: column_num,
                            });
                        }
                    }
                }
            }
        }
    }
    
    let mut unique_features: Vec<FeatureDiagnostic> = Vec::new();
    for diag in feature_diagnostics {
        let exists = unique_features.iter().any(|d| {
            d.crate_name == diag.crate_name && d.missing_feature == diag.missing_feature
        });
        if !exists {
            unique_features.push(diag);
        }
    }

    Ok(CheckResult {
        features: unique_features,
        errors: standard_errors,
    })
}

fn detect_crate_for_panic_handler(project_path: &str) -> Option<String> {
    let cargo_path = PathBuf::from(project_path).join("Cargo.toml");
    if let Ok(content) = fs::read_to_string(&cargo_path) {
        if let Ok(doc) = content.parse::<DocumentMut>() {
            if let Some(deps) = doc.get("dependencies").and_then(|i| i.as_table()) {
                if deps.contains_key("esp-backtrace") {
                    return Some("esp-backtrace".to_string());
                } else if deps.contains_key("esp-hal") {
                    // esp-hal doesn't provide a panic handler, but we can fall back to esp-backtrace directly
                    return Some("esp-backtrace".to_string());
                }
            }
        }
    }
    None
}

fn infer_chip_from_cargo(project_path: &str) -> String {
    let default_chip = "esp32".to_string();
    let cargo_path = PathBuf::from(project_path).join("Cargo.toml");
    if let Ok(content) = fs::read_to_string(&cargo_path) {
        if let Ok(doc) = content.parse::<DocumentMut>() {
            if let Some(deps) = doc.get("dependencies").and_then(|i| i.as_table()) {
                let chips = ["esp32", "esp32c2", "esp32c3", "esp32c6", "esp32h2", "esp32s2", "esp32s3", "esp32p4"];
                for (_, dep_val) in deps.iter() {
                    let features_iter = match dep_val {
                        toml_edit::Item::Table(t) => t.get("features").and_then(|f| f.as_array()),
                        toml_edit::Item::Value(toml_edit::Value::InlineTable(t)) => t.get("features").and_then(|f| f.as_array()),
                        _ => None,
                    };
                    if let Some(arr) = features_iter {
                        for v in arr.iter() {
                            if let Some(s) = v.as_str() {
                                if chips.contains(&s) {
                                    return s.to_string();
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    default_chip
}

fn parse_build_script_feature_error(stderr: &str, project_path: &str) -> Option<FeatureDiagnostic> {
    let lower_stderr = stderr.to_lowercase();
    if !lower_stderr.contains("exactly one of the following features") {
        return None;
    }
    
    let mut crate_name = "esp-hal".to_string();
    let mut options_str = String::new();
    
    for line in stderr.lines() {
        if line.contains("failed to run custom build command for `") {
            if let Some(start) = line.find('`') {
                let after = &line[start + 1..];
                if let Some(end) = after.find('`') {
                    let crate_and_ver = &after[..end]; // "esp-hal v1.0.0"
                    crate_name = crate_and_ver.split_whitespace().next().unwrap_or("esp-hal").to_string();
                }
            }
        } else if line.to_lowercase().contains("exactly one of the following features") {
            if let Some(idx) = line.find(':') {
                options_str = line[idx + 1..].trim().to_string();
            }
        }
    }
    
    let suggested_feature = if options_str.contains("esp32") {
        // It's a chip selection error
        infer_chip_from_cargo(project_path)
    } else if options_str.contains("println") {
        "println".to_string()
    } else if options_str.contains("defmt") {
        "defmt".to_string()
    } else {
        // Fallback: pick the first option if available
        options_str.split(',').next().unwrap_or("unknown").trim().to_string()
    };
    
    Some(FeatureDiagnostic {
        crate_name: crate_name.clone(),
        missing_feature: suggested_feature.clone(),
        file: "build.rs".to_string(),
        line: 0,
        help: format!("Missing feature for {}! From options [{}], '{}' was suggested automatically.", crate_name, options_str, suggested_feature),
    })
}

fn extract_missing_crate(msg: &str) -> Option<&str> {
    // "if you wanted to use a crate named `esp_hal`, use `cargo add esp_hal` to add it to your `Cargo.toml`"
    if let Some(start) = msg.find("cargo add ") {
        let after = &msg[start + 10..];
        if let Some(end) = after.find('`') {
            return Some(&after[..end]);
        }
    }
    None
}

fn extract_feature_name(msg: &str) -> Option<&str> {
    // "consider adding `feature = \"foo\"` to the `bar` dependency"
    if let Some(start) = msg.find("feature = \"") {
        let after_quote = &msg[start + 11..];
        if let Some(end) = after_quote.find('"') {
            return Some(&after_quote[..end]);
        }
    }
    None
}

fn extract_crate_name(msg: &str) -> Option<String> {
    if let Some(idx) = msg.rfind("` dependency") {
        let sub = &msg[..idx];
        if let Some(start) = sub.rfind("`") {
            let crate_name = &sub[start + 1..];
            return Some(crate_name.to_string());
        }
    }
    None
}

fn extract_gated_feature(label: &str) -> Option<&str> {
    // "the item is gated behind the `unstable` feature"
    if let Some(start) = label.find("`") {
        let after_quote = &label[start + 1..];
        if let Some(end) = after_quote.find("`") {
            return Some(&after_quote[..end]);
        }
    }
    None
}

/// Human-readable hint when rustc suggests a feature that no longer exists on crates.io.
fn obsolete_feature_hint(crate_name: &str, feature: &str) -> Option<&'static str> {
    match (crate_name, feature) {
        (
            "ssd1306",
            "i2c",
        ) => Some(
            "The `i2c` feature was removed from ssd1306 in newer releases (0.9+). I2C support does not use a Cargo feature anymore—remove `i2c` from [dependencies.ssd1306].features if it is listed. Enable `embedded-graphics-core` / `graphics` only if you use embedded-graphics integration.",
        ),
        _ => None,
    }
}

async fn fetch_crate_feature_keys(crate_name: &str) -> Result<Vec<String>, String> {
    let url = format!("https://crates.io/api/v1/crates/{}", crate_name);
    let client = reqwest::Client::builder()
        .user_agent("Rusteon-IDE/0.1.0")
        .build()
        .map_err(|e: reqwest::Error| e.to_string())?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e: reqwest::Error| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Crates.io returned status: {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e: reqwest::Error| e.to_string())?;

    if let Some(versions) = json.get("versions").and_then(|v| v.as_array()) {
        if let Some(latest) = versions.first() {
            if let Some(features_obj) = latest.get("features").and_then(|f| f.as_object()) {
                let mut features: Vec<String> = features_obj.keys().cloned().collect();
                features.sort();
                return Ok(features);
            }
            return Ok(Vec::new());
        }
    }

    Err("Could not find feature list for this crate".to_string())
}

fn extract_crate_from_path(path: &str) -> Option<String> {
    // "/home/.../index.crates.io-xyz/esp-hal-1.0.0/src/lib.rs"
    if let Some(idx) = path.find("/index.crates.io-") {
        let after = &path[idx..];
        let parts: Vec<&str> = after.split('/').collect();
        if parts.len() >= 3 {
            let crate_plus_ver = parts[2];
            // Remove the version suffix e.g. -1.0.0
            if let Some(dash_idx) = crate_plus_ver.rfind('-') {
                let after_dash = &crate_plus_ver[dash_idx + 1..];
                if after_dash.chars().next().map_or(false, |c| c.is_ascii_digit()) {
                    return Some(crate_plus_ver[..dash_idx].to_string());
                }
            }
            return Some(crate_plus_ver.to_string());
        }
    }
    None
}

fn required_features_for_missing_crate(crate_name: &str, chip: &str) -> Vec<String> {
    match crate_name {
        // Core esp-rs crates usually require exactly one chip feature.
        "esp-hal" | "esp-println" | "esp-bootloader-esp-idf" | "esp-radio" | "esp-wifi" => {
            vec![chip.to_string()]
        }
        // For no_std templates, these defaults are usually what users need to compile quickly.
        "esp-backtrace" => vec![chip.to_string(), "panic-handler".to_string(), "println".to_string()],
        _ => Vec::new(),
    }
}

#[tauri::command]
pub async fn remove_feature_from_cargo(
    project_path: String,
    crate_name: String,
    feature: String,
) -> Result<(), String> {
    let cargo_path = PathBuf::from(&project_path).join("Cargo.toml");
    if !cargo_path.exists() {
        return Err("Cargo.toml not found".to_string());
    }

    let content = fs::read_to_string(&cargo_path).map_err(|e| format!("Failed to read Cargo.toml: {}", e))?;
    let mut doc = content
        .parse::<DocumentMut>()
        .map_err(|e| format!("Failed to parse Cargo.toml: {}", e))?;

    if let Some(deps) = doc.get_mut("dependencies").and_then(|i| i.as_table_mut()) {
        if let Some(dep) = deps.get_mut(&crate_name) {
            if let Some(table) = dep.as_inline_table_mut() {
                if let Some(features) = table.get_mut("features") {
                    if let Some(arr) = features.as_array_mut() {
                        arr.retain(|v| v.as_str().map(|s| s != feature.as_str()).unwrap_or(true));
                    }
                }
            } else if let Some(table) = dep.as_table_mut() {
                if let Some(features) = table.get_mut("features") {
                    if let Some(arr) = features.as_array_mut() {
                        arr.retain(|v| v.as_str().map(|s| s != feature.as_str()).unwrap_or(true));
                    }
                }
            }
        } else {
            return Err(format!("Dependency '{}' not found in Cargo.toml", crate_name));
        }
    } else {
        return Err("No [dependencies] table found in Cargo.toml".to_string());
    }

    fs::write(&cargo_path, doc.to_string()).map_err(|e| format!("Failed to write Cargo.toml: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn add_feature_to_cargo(
    project_path: String,
    crate_name: String,
    feature: String,
) -> Result<(), String> {
    if let Some(hint) = obsolete_feature_hint(crate_name.as_str(), feature.as_str()) {
        return Err(format!(
            "{} Use \"Remove feature\" if this feature is already listed in Cargo.toml.",
            hint
        ));
    }

    match fetch_crate_feature_keys(crate_name.as_str()).await {
        Ok(keys) if !keys.is_empty() && !keys.contains(&feature) => {
            return Err(format!(
                "Feature `{}` is not available for crate `{}` on crates.io (latest metadata). Valid features include: {}.",
                feature,
                crate_name,
                keys.join(", ")
            ));
        }
        Ok(_) | Err(_) => {
            // Empty list or network failure: still try to apply (offline / odd crates).
        }
    }

    let cargo_path = PathBuf::from(&project_path).join("Cargo.toml");
    if !cargo_path.exists() {
        return Err("Cargo.toml not found".to_string());
    }

    let mut content = fs::read_to_string(&cargo_path).map_err(|e| format!("Failed to read Cargo.toml: {}", e))?;
    let mut doc = content.parse::<DocumentMut>().map_err(|e| format!("Failed to parse Cargo.toml: {}", e))?;

    if let Some(deps) = doc.get_mut("dependencies").and_then(|i| i.as_table_mut()) {
        if let Some(dep) = deps.get_mut(&crate_name) {
            if let Some(table) = dep.as_inline_table_mut() {
                if let Some(features) = table.get_mut("features") {
                    if let Some(arr) = features.as_array_mut() {
                        // Check if it already exists
                        let mut exists = false;
                        for v in arr.iter() {
                            if let Some(s) = v.as_str() {
                                if s == feature {
                                    exists = true;
                                    break;
                                }
                            }
                        }
                        if !exists {
                            arr.push(&feature);
                        }
                    }
                } else {
                    // Feature key does not exist but it's an inline table like { version = "1.0" }
                    let mut new_arr = toml_edit::Array::new();
                    new_arr.push(&feature);
                    table.insert("features", toml_edit::Value::Array(new_arr));
                }
            } else if let Some(table) = dep.as_table_mut() {
                if let Some(features) = table.get_mut("features") {
                    if let Some(arr) = features.as_array_mut() {
                         let mut exists = false;
                        for v in arr.iter() {
                            if let Some(s) = v.as_str() {
                                if s == feature {
                                    exists = true;
                                    break;
                                }
                            }
                        }
                        if !exists {
                            arr.push(&feature);
                        }
                    }
                } else {
                    let mut new_arr = toml_edit::Array::new();
                    new_arr.push(&feature);
                    table.insert("features", toml_edit::Item::Value(toml_edit::Value::Array(new_arr)));
                }
            } else if dep.as_str().is_some() {
                 // It's a plain string like smoltcp = "0.1"
                 let ver = dep.as_str().unwrap().to_string();
                 let mut inline = toml_edit::InlineTable::new();
                 inline.insert("version", ver.into());
                 let mut new_arr = toml_edit::Array::new();
                 new_arr.push(&feature);
                 inline.insert("features", toml_edit::Value::Array(new_arr));
                 *dep = toml_edit::Item::Value(toml_edit::Value::InlineTable(inline));
            }
        } else {
            return Err(format!("Dependency '{}' not found in Cargo.toml", crate_name));
        }
    } else {
         return Err("No [dependencies] table found in Cargo.toml".to_string());
    }

    fs::write(&cargo_path, doc.to_string()).map_err(|e| format!("Failed to write Cargo.toml: {}", e))?;
    Ok(())
}

#[derive(Serialize)]
pub struct CrateFeatures {
    pub name: String,
    pub version: String,
    pub features: Vec<String>,
}

#[tauri::command]
pub async fn get_crate_features(crate_name: String) -> Result<Vec<String>, String> {
    fetch_crate_feature_keys(crate_name.as_str()).await
}

#[tauri::command]
pub async fn add_crate_to_cargo(
    project_path: String,
    crate_name: String,
) -> Result<(), String> {
    let chip = infer_chip_from_cargo(&project_path);
    let features = required_features_for_missing_crate(crate_name.as_str(), chip.as_str());

    let mut cmd = Command::new("cargo");
    cmd.current_dir(&project_path)
       .arg("add")
       .arg(&crate_name)
       .env_remove("RUSTUP_TOOLCHAIN")
       .env_remove("CARGO");

    if !features.is_empty() {
        cmd.arg("--features").arg(features.join(","));
    }

    let output = cmd.output().map_err(|e| format!("Failed to run cargo add: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Cargo add failed: {}", stderr));
    }

    Ok(())
}
