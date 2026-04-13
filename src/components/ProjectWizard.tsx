import { useState, useEffect, useRef } from "react";
import { useIDEStore } from "../store/useIDEStore";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import { BOARDS, type BoardDefinition } from "../data/boards";

type Step = "form" | "toolchain-warning" | "installing" | "creating" | "success";

/** Options forwarded to `esp-generate --headless` (camelCase matches Rust serde). */
interface EspGenerateOptions {
  embassy: boolean;
  alloc: boolean;
  wifi: boolean;
  ble: boolean;
  espBacktrace: boolean;
  log: boolean;
  defmt: boolean;
  multicore: boolean;
  psram: boolean;
}


function isEspressifBoard(board: BoardDefinition | null | undefined): boolean {
  return board?.vendor === "Espressif";
}

const DEFAULT_ESP_OPTS: EspGenerateOptions = {
  embassy: false,
  alloc: false,
  wifi: false,
  ble: false,
  espBacktrace: true,
  log: false,
  defmt: false,
  multicore: false,
  psram: false,
};


type CargoTemplateKind = "embassy" | "stm32Hal" | "rp2040Official";

interface CargoGenerateOptions {
  templateKind: CargoTemplateKind;
  chip: string;
  stm32HalVersion: "last-release" | "git";
  rtic: boolean;
  defmt: boolean;
  svd: boolean;
  flashMethod: "probe-rs" | "picotool" | "custom" | "none";
}

function defaultCargoOpts(board: BoardDefinition): CargoGenerateOptions {
  const chip = board.defaultCargoChip ?? "rp2040";
  if (board.id === "stm32f4") {
    return {
      templateKind: "stm32Hal",
      chip,
      stm32HalVersion: "last-release",
      rtic: false,
      defmt: false,
      svd: false,
      flashMethod: "probe-rs",
    };
  }
  return {
    templateKind: "rp2040Official",
    chip,
    stm32HalVersion: "last-release",
    rtic: false,
    defmt: false,
    svd: false,
    flashMethod: "probe-rs",
  };
}

interface BoardInstallState {
  installed_targets: string[];
  espup_installed: boolean;
}

export function ProjectWizard() {
  const { isWizardOpen, setWizardOpen, setActiveProject, addLog, selectedBoard, addOpenTab, setActiveFile, setContent } = useIDEStore();

  const [projectName, setProjectName] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>(selectedBoard || "standard");
  const [espGenerateOpts, setEspGenerateOpts] = useState<EspGenerateOptions>({ ...DEFAULT_ESP_OPTS });
  const [cargoGenerateOpts, setCargoGenerateOpts] = useState<CargoGenerateOptions>({
    templateKind: "rp2040Official",
    chip: "rp2040",
    stm32HalVersion: "last-release",
    rtic: false,
    defmt: false,
    svd: false,
    flashMethod: "probe-rs",
  });
  const [step, setStep] = useState<Step>("form");
  const [errorMsg, setErrorMsg] = useState("");
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installDone, setInstallDone] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Resolve the active board definition from whichever template was chosen
  const activeBoardDef = selectedTemplate !== "standard"
    ? BOARDS.find(b => b.id === selectedTemplate) ?? null
    : null;
  const isEmbedded = !!activeBoardDef;

  useEffect(() => {
    if (!isWizardOpen) {
      setStep("form");
      setProjectName("");
      setParentDir("");
      setErrorMsg("");
      setInstallLog([]);
      setInstallDone(false);
      // Re-sync template to current board on re-open
      setSelectedTemplate(selectedBoard || "standard");
      setEspGenerateOpts({ ...DEFAULT_ESP_OPTS });
      const b = selectedBoard ? BOARDS.find(x => x.id === selectedBoard) : null;
      if (b && !isEspressifBoard(b)) setCargoGenerateOpts(defaultCargoOpts(b));
    }
  }, [isWizardOpen, selectedBoard]);

  useEffect(() => {
    if (!isWizardOpen) return;
    const b = BOARDS.find(x => x.id === selectedTemplate);
    if (b && !isEspressifBoard(b)) setCargoGenerateOpts(defaultCargoOpts(b));
  }, [isWizardOpen, selectedTemplate]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [installLog]);

  if (!isWizardOpen) return null;

  const handlePickDirectory = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: "Select Parent Folder" });
      if (selected && typeof selected === "string") { setParentDir(selected); setErrorMsg(""); }
    } catch (e) { console.error(e); }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProjectName(e.target.value.toLowerCase().replace(/\s+/g, "-"));
  };

  const validateForm = (): string | null => {
    if (!projectName.trim()) return "Project name is required.";
    if (!parentDir) return "Please select a destination folder.";
    if (!/^[a-z0-9_-]+$/.test(projectName)) return "Only lowercase, numbers, hyphens, and underscores allowed.";
    return null;
  };

  const handleFormSubmit = async () => {
    const err = validateForm();
    if (err) { setErrorMsg(err); return; }
    setErrorMsg("");
    if (!isEmbedded) { await doCreate(); return; }
    try {
      const state = await invoke<BoardInstallState>("check_installed_targets");
      const ok = state.installed_targets.includes(activeBoardDef!.target) ||
        (activeBoardDef!.installMethod === "espup" && state.espup_installed);
      if (ok) await doCreate(); else setStep("toolchain-warning");
    } catch { setStep("toolchain-warning"); }
  };

  const doCreate = async () => {
    setStep("creating");
    try {
      addLog(`Creating project '${projectName}' (${selectedTemplate})...`);
      const espOptions = isEspressifBoard(activeBoardDef) ? espGenerateOpts : null;
      const cargoGenerateOptions =
        activeBoardDef && !isEspressifBoard(activeBoardDef)
          ? {
              templateKind: cargoGenerateOpts.templateKind,
              chip: cargoGenerateOpts.chip.trim() || null,
              stm32HalVersion:
                cargoGenerateOpts.templateKind === "stm32Hal"
                  ? cargoGenerateOpts.stm32HalVersion
                  : null,
              rtic: cargoGenerateOpts.rtic,
              defmt: cargoGenerateOpts.defmt,
              svd: cargoGenerateOpts.svd,
              flashMethod:
                cargoGenerateOpts.templateKind === "rp2040Official"
                  ? cargoGenerateOpts.flashMethod
                  : null,
            }
          : null;
      const path = await invoke<string>("create_new_project", {
        name: projectName,
        parentDir,
        template: selectedTemplate,
        espOptions,
        cargoGenerateOptions,
      });
      addLog(`✓ Project '${projectName}' created at ${path}`);
      setActiveProject(path, projectName);
      // Persist and auto-open main.rs
      try { await invoke("save_last_project", { path, name: projectName }); } catch { /* ok */ }
      const mainPath = `${path}/src/main.rs`;
      try {
        const text = await invoke<string>("read_file_content", { path: mainPath });
        setActiveFile(mainPath);
        setContent(text);
        addOpenTab({ path: mainPath, name: "main.rs" });
      } catch { /* no main.rs yet */ }
      setStep("success");
    } catch (e) {
      setErrorMsg(String(e));
      addLog(`[Error] ${e}`);
      setStep("form");
    }
  };

  const handleInstallAndCreate = async () => {
    if (!activeBoardDef) return;
    setStep("installing");
    setInstallLog([]);
    setInstallDone(false);
    const unlisten = await listen<{ line: string }>("install-progress", (ev) => {
      setInstallLog(prev => [...prev, ev.payload.line]);
    });
    try {
      await invoke("install_board_target", { target: activeBoardDef.target, method: activeBoardDef.installMethod, espupTargets: activeBoardDef.espupTargets ?? null });
      setInstallLog(prev => [...prev, `✓ ${activeBoardDef.name} installed successfully!`]);
      setInstallDone(true);
      addLog(`Board ${activeBoardDef.name} installed.`);
    } catch (e) {
      setInstallLog(prev => [...prev, `✗ Installation failed: ${e}`]);
    } finally { unlisten(); }
  };

  const handleClose = () => setWizardOpen(false);

  // ── STEP: form ──────────────────────────────────────────────────────────
  if (step === "form") {
    const nameInvalid = projectName.length > 0 && !/^[a-z0-9_-]*$/.test(projectName);

    return (
      <>
        <div className="pw-overlay" onClick={handleClose} />
        <div className="pw-dialog">
          <div className="pw-header">
            <span className="pw-title">Create New Project</span>
            <button className="pw-close" onClick={handleClose}><CloseOutlinedIcon sx={{ fontSize: 18 }} /></button>
          </div>

          <div className="pw-body">
            {/* Name */}
            <div className="pw-field">
              <label className="pw-label">Project Name</label>
              <input className="bm-search" type="text" placeholder="e.g. my-blink-firmware"
                value={projectName} onChange={handleNameChange}
                style={{ width: "100%", borderRadius: "5px" }} />
              {nameInvalid && <span className="pw-name-error">Only lowercase, numbers, hyphens, and underscores allowed.</span>}
            </div>

            {/* Location */}
            <div className="pw-field">
              <label className="pw-label">Location</label>
              <div className="pw-input-row">
                <input className="bm-search" type="text" placeholder="Select a folder..."
                  value={parentDir} readOnly style={{ flex: 1, borderRadius: "5px", cursor: "default" }} />
                <button className="pw-browse-btn" onClick={handlePickDirectory} title="Browse...">
                  <FolderOpenOutlinedIcon sx={{ fontSize: 17 }} />
                </button>
              </div>
              {parentDir && projectName && !nameInvalid && (
                <span className="pw-path-hint">{parentDir}/{projectName}</span>
              )}
            </div>

            {/* Target Platform */}
            <div className="pw-field">
              <label className="pw-label">
                <span>Target Platform</span>
                {selectedBoard && selectedTemplate === selectedBoard && (
                  <span className="pw-badge">Board-Synced</span>
                )}
              </label>
              <select
                className="bm-version-select"
                value={selectedTemplate}
                onChange={e => setSelectedTemplate(e.target.value)}
                style={{ width: "100%", height: "32px", fontSize: "12px", padding: "0 8px", borderRadius: "5px" }}
              >
                <option value="standard">Standard Rust Binary</option>
                {BOARDS.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name} — {b.chip} ({b.arch.toUpperCase()})
                  </option>
                ))}
              </select>
              {activeBoardDef && (
                <span className="pw-hint">
                  Target: <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{activeBoardDef.target}</code>
                </span>
              )}
            </div>

            {activeBoardDef && !isEspressifBoard(activeBoardDef) && (
              <div className="pw-field">
                <label className="pw-label">cargo-generate template</label>
                <select
                  className="bm-version-select"
                  value={cargoGenerateOpts.templateKind}
                  onChange={e => {
                    const k = e.target.value as CargoTemplateKind;
                    setCargoGenerateOpts(o => {
                      const next = { ...o, templateKind: k };
                      if (k === "embassy" && activeBoardDef.defaultCargoChip) {
                        next.chip = activeBoardDef.defaultCargoChip;
                      }
                      if (k === "stm32Hal" && activeBoardDef.id === "stm32f4") {
                        next.chip = activeBoardDef.defaultCargoChip ?? "stm32f407vg";
                      }
                      if (k === "rp2040Official" && activeBoardDef.id === "rp2040") {
                        next.chip = activeBoardDef.defaultCargoChip ?? "rp2040";
                      }
                      return next;
                    });
                  }}
                  style={{ width: "100%", height: "32px", fontSize: "12px", padding: "0 8px", borderRadius: "5px" }}
                >
                  {activeBoardDef.id === "rp2040" ? (
                    <>
                      <option value="rp2040Official">Official rp-rs / rp2040-project-template</option>
                      <option value="embassy">Embassy (lulf/embassy-template)</option>
                    </>
                  ) : (
                    <>
                      <option value="stm32Hal">STM32 HAL — burrbull/stm32-template</option>
                      <option value="embassy">Embassy — lulf/embassy-template</option>
                    </>
                  )}
                </select>

                {(cargoGenerateOpts.templateKind === "embassy" || cargoGenerateOpts.templateKind === "stm32Hal") && (
                  <div style={{ marginTop: "10px" }}>
                    <label className="pw-label" style={{ marginBottom: "4px" }}>MCU / chip (—define chip=…)</label>
                    <input
                      className="bm-search"
                      type="text"
                      value={cargoGenerateOpts.chip}
                      onChange={e => setCargoGenerateOpts(o => ({ ...o, chip: e.target.value }))}
                      placeholder={activeBoardDef.defaultCargoChip ?? "e.g. stm32f407vg, rp2350a"}
                      style={{ width: "100%", borderRadius: "5px" }}
                    />
                  </div>
                )}

                {cargoGenerateOpts.templateKind === "stm32Hal" && (
                  <>
                    <div style={{ marginTop: "10px" }}>
                      <label className="pw-label" style={{ marginBottom: "4px" }}>HAL source</label>
                      <select
                        className="bm-version-select"
                        value={cargoGenerateOpts.stm32HalVersion}
                        onChange={e =>
                          setCargoGenerateOpts(o => ({
                            ...o,
                            stm32HalVersion: e.target.value as "last-release" | "git",
                          }))
                        }
                        style={{ width: "100%", height: "32px", fontSize: "12px", padding: "0 8px", borderRadius: "5px" }}
                      >
                        <option value="last-release">last-release (crates.io)</option>
                        <option value="git">git (stm32-rs nightlies)</option>
                      </select>
                    </div>
                    <div className="pw-esp-opts" style={{ marginTop: "8px" }}>
                      {([
                        ["rtic", "RTIC application", cargoGenerateOpts.rtic],
                        ["defmt", "defmt logging", cargoGenerateOpts.defmt],
                        ["svd", "SVD + VS Code task", cargoGenerateOpts.svd],
                      ] as const).map(([key, label, checked]) => (
                        <label key={key} className="pw-check">
                          <input
                            type="checkbox"
                            className="custom-checkbox"
                            checked={checked}
                            onChange={e => setCargoGenerateOpts(o => ({ ...o, [key]: e.target.checked }))}
                          />

                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}

                {cargoGenerateOpts.templateKind === "rp2040Official" && (
                  <div style={{ marginTop: "10px" }}>
                    <label className="pw-label" style={{ marginBottom: "4px" }}>Flash method</label>
                    <select
                      className="bm-version-select"
                      value={cargoGenerateOpts.flashMethod}
                      onChange={e =>
                        setCargoGenerateOpts(o => ({
                          ...o,
                          flashMethod: e.target.value as CargoGenerateOptions["flashMethod"],
                        }))
                      }
                      style={{ width: "100%", height: "32px", fontSize: "12px", padding: "0 8px", borderRadius: "5px" }}
                    >
                      <option value="probe-rs">probe-rs</option>
                      <option value="picotool">picotool</option>
                      <option value="none">none</option>
                      <option value="custom">custom</option>
                    </select>
                  </div>
                )}

                <span className="pw-hint" style={{ marginTop: "8px", display: "block" }}>
                  Runs <code style={{ fontSize: 10 }}>cargo generate --git … --allow-commands</code>.
                  Install: <code style={{ fontSize: 10 }}>cargo install cargo-generate --locked</code>.
                  Templates may run hooks (network, git).
                </span>
              </div>
            )}

            {activeBoardDef && isEspressifBoard(activeBoardDef) && (
              <div className="pw-field">
                <label className="pw-label">esp-generate options</label>
                <div className="pw-esp-opts">
                  {([
                    ["embassy", "Embassy (async)", espGenerateOpts.embassy],
                    ["alloc", "Heap (alloc)", espGenerateOpts.alloc],
                    ["wifi", "Wi‑Fi", espGenerateOpts.wifi],
                    ["ble", "BLE (bleps)", espGenerateOpts.ble],
                    ["espBacktrace", "esp-backtrace", espGenerateOpts.espBacktrace],
                    ["log", "log crate", espGenerateOpts.log],
                    ["defmt", "defmt logging", espGenerateOpts.defmt],
                    ["multicore", "Multicore support", espGenerateOpts.multicore],
                    ["psram", "PSRAM support", espGenerateOpts.psram],
                  ] as const).map(([key, label, checked]) => (

                    <label key={key} className="pw-check">
                      <input
                        type="checkbox"
                        className="custom-checkbox"
                        checked={checked}
                        onChange={e => setEspGenerateOpts(o => ({ ...o, [key]: e.target.checked }))}
                      />

                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <span className="pw-hint">
                  ESP projects are generated with <code style={{ fontSize: 10 }}>esp-generate --headless</code>
                  (install: <code style={{ fontSize: 10 }}>cargo install esp-generate --locked</code>).
                  <br />
                  Embassy, Wi‑Fi, and BLE require <code style={{ fontSize: 10 }}>unstable-hal</code>; Wi‑Fi and BLE also
                  pull in <code style={{ fontSize: 10 }}>alloc</code> automatically.
                </span>
              </div>
            )}

            {errorMsg && <div className="pw-error">{errorMsg}</div>}
          </div>

          <div className="pw-footer">
            <button className="pw-btn pw-btn--ghost" onClick={handleClose}>Cancel</button>
            <button className="pw-btn pw-btn--primary" onClick={handleFormSubmit}
              disabled={!projectName || !parentDir || nameInvalid}>
              Create Project
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── STEP: toolchain-warning ─────────────────────────────────────────────
  if (step === "toolchain-warning") {
    return (
      <>
        <div className="pw-overlay" />
        <div className="pw-dialog">
          <div className="pw-header">
            <span className="pw-title">
              <WarningAmberOutlinedIcon sx={{ fontSize: 18, color: "#e5c07b" }} />
              Toolchain Required
            </span>
          </div>

          <div className="pw-body">
            <div className="pw-warn-box">
              <div className="pw-warn-title">
                <WarningAmberOutlinedIcon sx={{ fontSize: 15 }} />
                Board support not installed
              </div>
              <div className="pw-warn-body">
                The <strong>{activeBoardDef?.name}</strong> template requires the <strong>{activeBoardDef?.target}</strong> toolchain.
                <br /><br />
                Without it, <code>cargo build</code> will fail immediately.
              </div>
            </div>
            <span className="pw-hint">Install it now via Rusteon, or create the project and install later.</span>
          </div>

          <div className="pw-footer">
            <button className="pw-btn pw-btn--ghost" onClick={handleClose}>Cancel</button>
            <button className="pw-btn pw-btn--warn" onClick={doCreate}>Create Anyway</button>
            <button className="pw-btn pw-btn--primary" onClick={handleInstallAndCreate}>
              Install &amp; Create
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── STEP: installing ────────────────────────────────────────────────────
  if (step === "installing") {
    return (
      <>
        <div className="pw-overlay" />
        <div className="pw-dialog">
          <div className="pw-header">
            <span className="pw-title">Installing {activeBoardDef?.name} toolchain...</span>
          </div>
          <div className="pw-body">
            <div className="pw-log">
              {installLog.map((line, i) => (
                <div key={i} className={`pw-log-line${line.startsWith("✓") ? " pw-log-line--ok" : line.startsWith("✗") ? " pw-log-line--err" : ""}`}>
                  {line}
                </div>
              ))}
              {!installDone && <div className="pw-log-cursor">▋</div>}
              <div ref={logEndRef} />
            </div>
          </div>
          {installDone && (
            <div className="pw-footer">
              <button className="pw-btn pw-btn--primary" onClick={doCreate}>
                <CheckCircleOutlineIcon sx={{ fontSize: 15 }} />
                Create Project
              </button>
            </div>
          )}
        </div>
      </>
    );
  }

  // ── STEP: creating ──────────────────────────────────────────────────────
  if (step === "creating") {
    return (
      <>
        <div className="pw-overlay" />
        <div className="pw-dialog">
          <div className="pw-header">
            <span className="pw-title">Creating project...</span>
          </div>
          <div className="pw-creating">
            <div className="pw-spinner" />
            {isEspressifBoard(activeBoardDef) ? (
              <>Running <code style={{ fontSize: 11 }}>esp-generate</code> for {projectName}</>
            ) : activeBoardDef ? (
              <>Running <code style={{ fontSize: 11 }}>cargo generate</code> for {projectName}</>
            ) : (
              <>Running <code style={{ fontSize: 11 }}>cargo new {projectName}</code></>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── STEP: success ───────────────────────────────────────────────────────
  if (step === "success") {
    return (
      <>
        <div className="pw-overlay" onClick={handleClose} />
        <div className="pw-dialog" style={{ width: "400px" }}>
          <div className="pw-header">
            <span className="pw-title">Project Created!</span>
            <button className="pw-close" onClick={handleClose}><CloseOutlinedIcon sx={{ fontSize: 18 }} /></button>
          </div>
          <div className="pw-body" style={{ alignItems: "center", textAlign: "center", padding: "32px 16px" }}>
            <CheckCircleOutlineIcon sx={{ fontSize: 56, color: "var(--ide-accent)", marginBottom: "8px" }} />
            <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--ide-text)" }}>
              {projectName} is ready.
            </div>
            <div style={{ fontSize: "12px", color: "var(--ide-text-faint)", marginTop: "12px", maxWidth: "90%" }}>
              Successfully generated at:
              <br/>
              <code style={{ fontSize: "11px", color: "var(--ide-text)", background: "var(--ide-bg)", padding: "4px 8px", borderRadius: "5px", display: "inline-block", marginTop: "6px", wordBreak: "break-all", border: "1px solid var(--ide-border-light)" }}>
                {parentDir}/{projectName}
              </code>
            </div>
          </div>
          <div className="pw-footer">
            <button className="pw-btn pw-btn--primary" onClick={handleClose} style={{ width: "100%", justifyContent: "center", padding: "8px" }}>
              Start Coding
            </button>
          </div>
        </div>
      </>
    );
  }

  return null;
}
