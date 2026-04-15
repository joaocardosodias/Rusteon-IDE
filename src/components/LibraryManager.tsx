import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useIDEStore } from "../store/useIDEStore";
import { searchCrates, getCrateVersions, CrateInfo } from "../api/crates";
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import SearchIcon from '@mui/icons-material/Search';import BuildIcon from '@mui/icons-material/Build';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';

// Curated libs shown by default
const curatedLibs = [
  { name: "esp-hal", by: "esp-rs", desc: "Hardware abstraction layer for ESP32. Supports GPIO, SPI, I2C, UART and more." },
  { name: "esp-backtrace", by: "esp-rs", desc: "Panic handler and backtrace for ESP devices without an OS." },
  { name: "esp-println", by: "esp-rs", desc: "Standard println! macro for ESP32 via UART or RTT." },
  { name: "embassy-executor", by: "embassy-rs", desc: "High performance async executor for no_std embedded systems." },
  { name: "embassy-time", by: "embassy-rs", desc: "Async time primitives: Timer, Delay, Instant." },
  { name: "heapless", by: "japaric", desc: "Heapless static data structures: Vec, String, Queue and more." },
  { name: "embedded-hal", by: "rust-embedded", desc: "Abstract traits for portable embedded hardware drivers." },
  { name: "smoltcp", by: "smoltcp-rs", desc: "Standalone TCP/IP stack for no_std embedded systems." },
];

const GLOBAL_VERSION_CACHE: Record<string, string[]> = {};
const GLOBAL_DESC_CACHE: Record<string, string> = {};

type LibStatus = 'idle' | 'installing' | 'installed' | 'removing' | 'error';


interface InstalledLib {
  name: string;
  version: string;
}

export function LibraryManager() {
  const { activeProjectPath, addLog, featureDiagnostics, setFeatureDiagnostics } = useIDEStore();

  const [activeTab, setActiveTab] = useState<"curated" | "search" | "installed" | "diagnostics">("curated");
  const [installedLibs, setInstalledLibs] = useState<InstalledLib[]>([]);
  const [libStatus, setLibStatus] = useState<Record<string, LibStatus>>({});
  const [libErrors, setLibErrors] = useState<Record<string, string>>({});
  const [crateDescriptions, setCrateDescriptions] = useState<Record<string, string>>(GLOBAL_DESC_CACHE);
  // versions[name] = array of version strings fetched from crates.io
  const [crateVersions, setCrateVersions] = useState<Record<string, string[]>>(GLOBAL_VERSION_CACHE);
  // selectedVersion[name] = currently-chosen version in the dropdown
  const [selectedVersion, setSelectedVersion] = useState<Record<string, string>>({});

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CrateInfo[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [hasPreloaded, setHasPreloaded] = useState(false);

  /** Crate name when the install + features panel is open (curated / search only). */
  const [installPanelCrate, setInstallPanelCrate] = useState<string | null>(null);
  const [installPanelVersion, setInstallPanelVersion] = useState<string | undefined>(undefined);
  const [installPanelFeatures, setInstallPanelFeatures] = useState<string[]>([]);
  const [installPanelLoading, setInstallPanelLoading] = useState(false);
  const [installPanelError, setInstallPanelError] = useState<string | null>(null);
  const [installPanelChecked, setInstallPanelChecked] = useState<Record<string, boolean>>({});
  const [diagnosticBusy, setDiagnosticBusy] = useState<Record<string, boolean>>({});

  // Fetch installed libs when project path changes
  useEffect(() => {
    if (activeProjectPath) {
      fetchInstalled();
    }
  }, [activeProjectPath]);

  // Pre-load Search tab with "embedded" keyword
  useEffect(() => {
    if (activeTab === "search" && !hasPreloaded) {
      runSearch("embedded");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const fetchInstalled = async () => {
    try {
      const libs = await invoke<InstalledLib[]>("get_project_libraries", { projectPath: activeProjectPath });
      setInstalledLibs(libs);
      // Sync status map
      setLibStatus(prev => {
        const next = { ...prev };
        libs.forEach(l => {
          if (!next[l.name] || next[l.name] === 'idle') {
            next[l.name] = 'installed';
          }
        });
        return next;
      });
      // Fetch descriptions for installed libs not already known
      libs.forEach(async (lib) => {
        const knownDesc = curatedLibs.find(c => c.name === lib.name)?.desc;
        if (knownDesc) {
          GLOBAL_DESC_CACHE[lib.name] = knownDesc;
          setCrateDescriptions(prev => ({ ...prev, [lib.name]: knownDesc }));
          return;
        }
        try {
          const res = await searchCrates(lib.name, 1, 1);
          const match = res.crates.find(c => c.name === lib.name);
          if (match?.description) {
            GLOBAL_DESC_CACHE[lib.name] = match.description;
            setCrateDescriptions(prev => ({ ...prev, [lib.name]: match.description }));
          }
        } catch { /* silent */ }
      });
    } catch (e) {
      addLog(`[Error] Failed to read Cargo.toml: ${e}`);
    }
  };

  const runSearch = async (query: string) => {
    if (!query.trim()) return;
    setLoadingSearch(true);
    setHasPreloaded(true);
    try {
      const res = await searchCrates(query.trim(), 1, 15);
      setSearchResults(res.crates);
    } catch (e) {
      addLog(`[Error] Crates.io fetch failed: ${e}`);
    } finally {
      setLoadingSearch(false);
    }
  };

  const handleSearch = () => runSearch(searchQuery);

  const getStatus = (name: string): LibStatus => {
    if (libStatus[name]) return libStatus[name];
    return installedLibs.some(l => l.name === name) ? 'installed' : 'idle';
  };

  const getVersion = (name: string) => installedLibs.find(l => l.name === name)?.version;

  const removeLib = async (name: string) => {
    if (!activeProjectPath) return;
    if (!confirm(`Remove package "${name}" from your project?`)) return;

    setLibStatus(prev => ({ ...prev, [name]: 'removing' }));
    addLog(`> cargo remove ${name}`);
    try {
      await invoke("remove_library_from_project", { projectPath: activeProjectPath, libName: name });
      addLog(`✓ ${name} removed from Cargo.toml`);
      setLibStatus(prev => ({ ...prev, [name]: 'idle' }));
      await fetchInstalled();
    } catch (e) {
      addLog(`[Error] cargo remove failed: ${e}`);
      setLibStatus(prev => ({ ...prev, [name]: 'error' }));
      setLibErrors(prev => ({ ...prev, [name]: String(e) }));
    }
  };

  const retryLib = (name: string) => {
    setLibStatus(prev => ({ ...prev, [name]: 'idle' }));
    setLibErrors(prev => { const n = { ...prev }; delete n[name]; return n; });
  };

  // Lazily fetch versions for a crate when first needed
  const ensureVersions = async (name: string) => {
    if (GLOBAL_VERSION_CACHE[name]) return;
    try {
      const versions = await getCrateVersions(name);
      const nums = versions.map(v => v.num);
      GLOBAL_VERSION_CACHE[name] = nums;
      setCrateVersions(prev => ({ ...prev, [name]: nums }));
      // Set default selected to newest
      setSelectedVersion(prev => ({ ...prev, [name]: prev[name] ?? nums[0] }));
    } catch { /* silent */ }
  };

  useEffect(() => {
    if (activeTab === "curated") {
      curatedLibs.forEach(lib => ensureVersions(lib.name));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    setInstallPanelCrate(null);
    setInstallPanelError(null);
    setInstallPanelFeatures([]);
    setInstallPanelChecked({});
  }, [activeTab]);

  const getSelectedVersion = (name: string, fallback?: string) =>
    selectedVersion[name] ?? fallback ?? '';

  const closeInstallPanel = () => {
    setInstallPanelCrate(null);
    setInstallPanelVersion(undefined);
    setInstallPanelFeatures([]);
    setInstallPanelError(null);
    setInstallPanelChecked({});
    setInstallPanelLoading(false);
  };

  const openInstallPanel = async (name: string, version?: string) => {
    if (installPanelCrate === name) {
      closeInstallPanel();
      return;
    }
    setInstallPanelCrate(name);
    setInstallPanelVersion(version);
    setInstallPanelFeatures([]);
    setInstallPanelError(null);
    setInstallPanelChecked({});
    setInstallPanelLoading(true);
    try {
      const feats = await invoke<string[]>("get_crate_features", { crateName: name });
      const sorted = [...feats].filter(Boolean).sort((a, b) => a.localeCompare(b));
      setInstallPanelFeatures(sorted);
    } catch (e) {
      setInstallPanelError(String(e));
    } finally {
      setInstallPanelLoading(false);
    }
  };

  const installLib = async (name: string, version?: string, extraFeatures: string[] | null = null) => {
    const status = getStatus(name);
    if (status === 'installing' || status === 'removing' || !activeProjectPath) return;

    const features =
      extraFeatures && extraFeatures.length > 0 ? extraFeatures : null;
    const featStr = features?.length ? ` --features ${features.join(",")}` : "";

    setLibStatus(prev => ({ ...prev, [name]: 'installing' }));
    setLibErrors(prev => {
      const n = { ...prev };
      delete n[name];
      return n;
    });
    const versionNorm = version?.trim() ? version.trim() : null;
    addLog(`> cargo add ${name}${versionNorm ? `@${versionNorm}` : ""}${featStr}`);

    try {
      await invoke("add_library_to_project", {
        projectPath: activeProjectPath,
        libName: name,
        version: versionNorm,
        features,
      });
      addLog(`✓ ${name} added to Cargo.toml`);
      setLibStatus(prev => ({ ...prev, [name]: 'installed' }));
      closeInstallPanel();
      await fetchInstalled();
    } catch (e) {
      const msg = String(e);
      addLog(`[Error] ${msg}`);
      setLibStatus(prev => ({ ...prev, [name]: 'error' }));
      setLibErrors(prev => ({ ...prev, [name]: msg }));
    }
  };

  const confirmInstallFromPanel = () => {
    if (!installPanelCrate || !activeProjectPath) return;
    const picked = Object.entries(installPanelChecked)
      .filter(([, on]) => on)
      .map(([f]) => f);
    const fallback =
      getVersion(installPanelCrate) || installPanelVersion || undefined;
    const verRaw = getSelectedVersion(installPanelCrate, fallback);
    const version = verRaw.trim() || undefined;
    void installLib(installPanelCrate, version, picked.length ? picked : null);
  };

  const renderInstallFeaturePanel = (crateName: string) => {
    if (installPanelCrate !== crateName) return null;
    const selectedCount = Object.values(installPanelChecked).filter(Boolean).length;

    return (
      <div className="bm-install-panel">
        <div className="bm-install-panel-hint">
          Optional Cargo features (from crates.io). Leave all unchecked for a plain <code style={{ fontSize: 9 }}>cargo add</code> (crate default features still apply).
        </div>
        {installPanelLoading && (
          <div style={{ fontSize: 11, color: "var(--ide-text-faint)" }}>Loading feature list…</div>
        )}
        {installPanelError && !installPanelLoading && (
          <div style={{ fontSize: 10.5, color: "#e06c75", marginBottom: 6 }}>
            {installPanelError}
          </div>
        )}
        {!installPanelLoading && installPanelFeatures.length > 0 && (
          <div className="bm-install-features-grid">
            {installPanelFeatures.map(feat => (
              <label key={feat} className="bm-install-feature-row">
                <input
                  type="checkbox"
                  className="custom-checkbox"
                  checked={!!installPanelChecked[feat]}
                  onChange={e =>
                    setInstallPanelChecked(prev => ({ ...prev, [feat]: e.target.checked }))
                  }
                />

                <span>{feat}</span>
              </label>
            ))}
          </div>
        )}
        <div className="bm-install-panel-actions">
          <button
            type="button"
            className="bm-btn bm-btn--install"
            onClick={() => void confirmInstallFromPanel()}
            disabled={
              !activeProjectPath ||
              libStatus[crateName] === "installing" ||
              Object.values(libStatus).some(s => s === "installing" || s === "removing")
            }
          >
            <DownloadIcon sx={{ fontSize: 13 }} />
            {selectedCount > 0 ? `Install (${selectedCount} features)` : "Install"}
          </button>
          <button type="button" className="bm-btn--ghost-sm" onClick={closeInstallPanel}>
            Cancel
          </button>
        </div>
      </div>
    );
  };

  // Render action buttons — mirrors BoardManager button logic exactly
  const renderActions = (name: string, version?: string) => {
    const status = getStatus(name);
    const isAnyBusy = Object.values(libStatus).some(s => s === 'installing' || s === 'removing');

    if (status === 'installing') {
      return (
        <button className="bm-btn bm-btn--progress" disabled>
          <div className="bm-progress-fill" style={{ width: '100%' }} />
          <span className="bm-progress-text">Installing...</span>
        </button>
      );
    }
    if (status === 'removing') {
      return (
        <button className="bm-btn bm-btn--removing" disabled>
          Removing...
        </button>
      );
    }
    if (status === 'installed') {
      return (
        <div className="bm-action-group">
          <button className="bm-btn bm-btn--installed" disabled>
            <CheckCircleIcon sx={{ fontSize: 13 }} />
            INSTALLED
          </button>
          <button
            className="bm-btn bm-btn--remove"
            onClick={() => removeLib(name)}
            title="Remove from Cargo.toml"
            disabled={isAnyBusy}
          >
            <DeleteOutlinedIcon sx={{ fontSize: 14 }} />
          </button>
        </div>
      );
    }
    if (status === 'error') {
      return (
        <div className="bm-action-group">
          <button className="bm-btn bm-btn--error" disabled>
            <ErrorOutlinedIcon sx={{ fontSize: 13 }} />
            FAILED
          </button>
          <button className="bm-btn bm-btn--install" onClick={() => retryLib(name)}>
            RETRY
          </button>
        </div>
      );
    }
    return (
      <button
        className="bm-btn bm-btn--install"
        onClick={() => void openInstallPanel(name, version)}
        disabled={isAnyBusy}
        title="Choose optional Cargo features, then install"
      >
        <DownloadIcon sx={{ fontSize: 13 }} />
        INSTALL…
      </button>
    );
  };

  const diagKey = (diag: { crate_name: string; missing_feature: string; file: string; line: number }, idx: number) =>
    `${diag.crate_name}:${diag.missing_feature}:${diag.file}:${diag.line}:${idx}`;

  return (
    <div className="board-manager">

      {/* Tabs */}
      <div className="bm-tabs" style={{ display: 'flex', borderBottom: '1px solid var(--ide-border)', margin: '0 12px 2px' }}>
        {(['curated', 'search', 'installed', 'diagnostics'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: 'transparent',
              border: 'none',
              color: activeTab === tab ? 'var(--ide-accent)' : 'var(--ide-text-faint)',
              padding: '9px 8px 8px',
              fontSize: '11.5px',
              cursor: 'pointer',
              borderBottom: activeTab === tab ? '2px solid var(--ide-accent)' : '2px solid transparent',
              flex: 1,
              textTransform: 'capitalize',
              fontWeight: activeTab === tab ? 600 : 400,
              letterSpacing: '0.3px',
            }}
          >
            {tab}
            {tab === 'diagnostics' && featureDiagnostics.length > 0 && (
              <span style={{
                marginLeft: '4px', background: '#ff3a3a', color: '#fff',
                padding: '2px 6px', borderRadius: '10px', fontSize: '9px', fontWeight: 'bold'
              }}>
                {featureDiagnostics.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search bar — always visible, button only on search tab */}
      <div className="bm-search-wrap" style={{ display: 'flex', alignItems: 'center' }}>
        <input
          id="lib-search"
          type="text"
          placeholder={activeTab === "search" ? "Search crates.io..." : "Filter libraries..."}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="bm-search"
          autoComplete="off"
        />
        {activeTab === "search" && (
          <button
            onClick={handleSearch}
            disabled={loadingSearch}
            title="Search crates.io"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255, 158, 0, 0.1)',
              border: '1px solid rgba(255, 158, 0, 0.3)',
              borderRadius: '4px',
              color: loadingSearch ? 'var(--ide-text-faint)' : 'var(--ide-accent)',
              padding: '0 7px',
              marginLeft: '6px',
              cursor: loadingSearch ? 'wait' : 'pointer',
              height: '28px',
              transition: 'opacity 0.2s',
            }}
          >
            <SearchIcon sx={{ fontSize: 16 }} />
          </button>
        )}
      </div>

      {/* List */}
      <div className="bm-list">

        {/* CURATED */}
        {activeTab === "curated" && (
          <div className="bm-vendor-group">
            <button className="bm-vendor-header" style={{ cursor: 'default' }}>
              <span className="bm-vendor-name">Embedded / Curated</span>
              <span className="bm-vendor-count">{curatedLibs.length}</span>
            </button>

            {curatedLibs
              .filter(l => !searchQuery || l.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map(lib => {
              const status = getStatus(lib.name);
              const err = libErrors[lib.name];
              const iVersion = getVersion(lib.name);
              return (
                <div key={lib.name} className="bm-card" id={`lib-item-${lib.name}`}>
                  <div className="bm-card-header">
                    <MenuBookIcon sx={{ fontSize: 18, color: 'var(--ide-accent)', flexShrink: 0 }} />
                    <div className="bm-card-info">
                      <div className="bm-card-name">{lib.name}</div>
                      <div className="bm-card-meta">
                        <span className="bm-arch-badge" style={{ color: '#888', borderColor: '#444' }}>
                          by {lib.by}
                        </span>
                        {iVersion && <span className="bm-card-target">v{iVersion}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="bm-card-desc">{lib.desc}</div>

                  <div className="bm-card-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
                    onMouseEnter={() => ensureVersions(lib.name)}
                  >
                    <select
                      className="bm-version-select"
                      value={getSelectedVersion(lib.name, iVersion || '')}
                      onChange={e => setSelectedVersion(prev => ({ ...prev, [lib.name]: e.target.value }))}
                    >
                      {crateVersions[lib.name]
                        ? crateVersions[lib.name].map(v => <option key={v} value={v}>{v}</option>)
                        : <option>{iVersion || '...'}</option>
                      }
                    </select>

                    <button
                      className="bm-btn-ghost"
                      onClick={() => openUrl(`https://crates.io/crates/${lib.name}`)}
                      title="View on crates.io"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', color: 'var(--ide-accent)', background: 'rgba(255, 158, 0, 0.1)', border: '1px solid rgba(255, 158, 0, 0.3)', cursor: 'pointer', borderRadius: '4px' }}
                    >
                      <InfoOutlinedIcon sx={{ fontSize: 15 }} />
                    </button>

                    {renderActions(
                      lib.name,
                      getSelectedVersion(lib.name, iVersion || undefined) || undefined
                    )}
                  </div>

                  {renderInstallFeaturePanel(lib.name)}

                  {status === 'installing' && (
                    <div className="bm-progress-bar">
                      <div className="bm-progress-bar-fill bm-progress-bar-fill--indeterminate" />
                    </div>
                  )}

                  {status === 'error' && err && (
                    <div className="bm-error-msg">{err}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* SEARCH */}
        {activeTab === "search" && (
          <>
            {loadingSearch && (
              <div className="bm-empty">
                <div className="bm-loading-spinner" />
                <p>Searching crates.io...</p>
              </div>
            )}
            {!loadingSearch && searchResults.length === 0 && (
              <div className="bm-empty">
                <MenuBookIcon sx={{ fontSize: 32, opacity: 0.3 }} />
                <p>No packages found</p>
              </div>
            )}
            {!loadingSearch && searchResults.length > 0 && (
              <div className="bm-vendor-group">
                <button className="bm-vendor-header" style={{ cursor: 'default' }}>
                  <span className="bm-vendor-name">crates.io results</span>
                  <span className="bm-vendor-count">{searchResults.length}</span>
                </button>
                {searchResults.map(lib => {
                  const status = getStatus(lib.name);
                  const err = libErrors[lib.name];
                  const iVersion = getVersion(lib.name);
                  return (
                    <div key={lib.name} className="bm-card" id={`lib-search-${lib.name}`}>
                      <div className="bm-card-header">
                        <MenuBookIcon sx={{ fontSize: 18, color: 'var(--ide-accent)', flexShrink: 0 }} />
                        <div className="bm-card-info">
                          <div className="bm-card-name">{lib.name}</div>
                          <div className="bm-card-meta">
                            <span className="bm-arch-badge" style={{ color: '#888', borderColor: '#444' }}>
                              v{lib.newest_version}
                            </span>
                            <span className="bm-card-target">⬇ {lib.recent_downloads}</span>
                          </div>
                        </div>
                      </div>

                      <div className="bm-card-desc">{lib.description || "No description available."}</div>

                      <div className="bm-card-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
                        onMouseEnter={() => ensureVersions(lib.name)}
                      >
                        <select
                          className="bm-version-select"
                          value={getSelectedVersion(lib.name, iVersion || lib.newest_version)}
                          onChange={e => setSelectedVersion(prev => ({ ...prev, [lib.name]: e.target.value }))}
                        >
                          {crateVersions[lib.name]
                            ? crateVersions[lib.name].map(v => <option key={v} value={v}>{v}</option>)
                            : <option>{iVersion || lib.newest_version}</option>
                          }
                        </select>

                        <button
                          className="bm-btn-ghost"
                          onClick={() => openUrl(`https://crates.io/crates/${lib.name}`)}
                          title="View on crates.io"
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', color: 'var(--ide-accent)', background: 'rgba(255,158,0,0.1)', border: '1px solid rgba(255,158,0,0.3)', cursor: 'pointer', borderRadius: '4px' }}
                        >
                          <InfoOutlinedIcon sx={{ fontSize: 15 }} />
                        </button>

                        {renderActions(
                          lib.name,
                          getSelectedVersion(lib.name, lib.newest_version) || undefined
                        )}
                      </div>

                      {renderInstallFeaturePanel(lib.name)}

                      {status === 'installing' && (
                        <div className="bm-progress-bar">
                          <div className="bm-progress-bar-fill bm-progress-bar-fill--indeterminate" />
                        </div>
                      )}

                      {status === 'error' && err && (
                        <div className="bm-error-msg">{err}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* INSTALLED */}
        {activeTab === "installed" && (
          <>
            {installedLibs.length === 0 ? (
              <div className="bm-empty">
                <MenuBookIcon sx={{ fontSize: 32, opacity: 0.3 }} />
                <p>No packages in Cargo.toml</p>
              </div>
            ) : (
              <div className="bm-vendor-group">
                <button className="bm-vendor-header" style={{ cursor: 'default' }}>
                  <span className="bm-vendor-name">Project Dependencies</span>
                  <span className="bm-vendor-count">{installedLibs.length}</span>
                </button>
                {installedLibs
                  .filter(l => !searchQuery || l.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map(lib => {
                  const status = getStatus(lib.name);
                  const err = libErrors[lib.name];
                  return (
                    <div key={lib.name} className="bm-card" id={`lib-installed-${lib.name}`}>
                      <div className="bm-card-header">
                        <MenuBookIcon sx={{ fontSize: 18, color: 'var(--ide-accent)', flexShrink: 0 }} />
                        <div className="bm-card-info">
                          <div className="bm-card-name">{lib.name}</div>
                          <div className="bm-card-meta">
                            <span className="bm-arch-badge" style={{ color: 'var(--ide-accent)', borderColor: 'rgba(255, 158, 0, 0.3)' }}>
                              installed
                            </span>
                            <span className="bm-card-target">v{lib.version}</span>
                          </div>
                        </div>
                      </div>

                      {crateDescriptions[lib.name] && (
                        <div className="bm-card-desc">{crateDescriptions[lib.name]}</div>
                      )}

                      <div className="bm-card-details">
                        <span className="bm-detail-tag">
                          <code>{lib.name}</code>
                        </span>
                        <span className="bm-detail-tag" style={{ color: '#98c379' }}>
                          v{lib.version}
                        </span>
                      </div>

                      <div className="bm-card-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <select className="bm-version-select" disabled>
                          <option>{lib.version}</option>
                        </select>

                        <button
                          className="bm-btn-ghost"
                          onClick={() => openUrl(`https://crates.io/crates/${lib.name}`)}
                          title="View on crates.io"
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', color: 'var(--ide-accent)', background: 'rgba(255,158,0,0.1)', border: '1px solid rgba(255,158,0,0.3)', cursor: 'pointer', borderRadius: '4px' }}
                        >
                          <InfoOutlinedIcon sx={{ fontSize: 15 }} />
                        </button>

                        {renderActions(lib.name, lib.version)}
                      </div>

                      {renderInstallFeaturePanel(lib.name)}

                      {status === 'removing' && (
                        <div className="bm-progress-bar">
                          <div className="bm-progress-bar-fill bm-progress-bar-fill--indeterminate" />
                        </div>
                      )}

                      {status === 'error' && err && (
                        <div className="bm-error-msg">{err}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* DIAGNOSTICS */}
        {activeTab === "diagnostics" && (
          <div className="bm-diagnostics" style={{ padding: '8px 12px', flex: 1, overflowY: 'auto' }}>
            {featureDiagnostics.length === 0 ? (
              <div className="bm-empty">
                <CheckCircleIcon sx={{ fontSize: 32, opacity: 0.3, color: 'var(--ide-accent)', mb: 1 }} />
                <p>No missing features detected.</p>
                <div style={{ fontSize: '11px', color: 'var(--ide-text-faint)', marginTop: '8px' }}>
                  Cargo will analyze your code when you Build.
                </div>
              </div>
            ) : (
              <>
                <div className="bm-vendor-group">
                   <button className="bm-vendor-header" style={{ cursor: 'default', background: 'rgba(255, 58, 58, 0.05)' }}>
                    <span className="bm-vendor-name" style={{ color: '#ff3a3a' }}>Missing Features Detected</span>
                    <span className="bm-vendor-count" style={{ background: '#ff3a3a' }}>{featureDiagnostics.length}</span>
                  </button>
                  {featureDiagnostics.map((diag, idx) => {
                    const isMissingCrate = diag.missing_feature === "";
                    const key = diagKey(diag, idx);
                    const busy = !!diagnosticBusy[key];
                    
                    return (
                    <div key={idx} className="bm-card" style={{ borderLeft: '3px solid #ff3a3a' }}>
                      <div className="bm-card-header">
                        <BuildIcon sx={{ fontSize: 18, color: '#ff3a3a', flexShrink: 0 }} />
                        <div className="bm-card-info">
                          <div className="bm-card-name" style={{ color: isMissingCrate ? '#ff3a3a' : 'inherit' }}>
                            {isMissingCrate ? `Missing Crate: ${diag.crate_name}` : diag.crate_name}
                          </div>
                          <div className="bm-card-meta">
                            {!isMissingCrate && (
                              <span className="bm-arch-badge" style={{ color: '#ff3a3a', borderColor: '#ff3a3a', fontWeight: 'bold' }}>
                                + {diag.missing_feature}
                              </span>
                            )}
                             <span className="bm-card-target" style={{ marginLeft: isMissingCrate ? 0 : '6px' }}>{diag.file}:{diag.line}</span>
                          </div>
                        </div>
                      </div>

                      <div className="bm-card-desc" style={{ fontStyle: 'italic', marginTop: '6px' }}>
                        "{diag.help}"
                      </div>

                      <div className="bm-card-actions" style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {diag.crate_name === "ssd1306" && diag.missing_feature === "i2c" && (
                          <button
                            className="bm-btn bm-btn--install"
                            style={{ background: '#e5a50a' }}
                            title="ssd1306 no longer exposes an `i2c` Cargo feature; remove it from Cargo.toml if present."
                            onClick={async () => {
                              if (!activeProjectPath) return;
                              setDiagnosticBusy(prev => ({ ...prev, [key]: true }));
                              try {
                                await invoke("remove_feature_from_cargo", {
                                  projectPath: activeProjectPath,
                                  crateName: diag.crate_name,
                                  feature: diag.missing_feature,
                                });
                                addLog(`✓ Removed obsolete feature 'i2c' from ${diag.crate_name}`);
                                setFeatureDiagnostics(featureDiagnostics.filter((_, i) => i !== idx));
                                fetchInstalled();
                              } catch (e) {
                                addLog(`[Error] Failed to remove feature: ${e}`);
                              } finally {
                                setDiagnosticBusy(prev => {
                                  const n = { ...prev };
                                  delete n[key];
                                  return n;
                                });
                              }
                            }}
                            disabled={busy || !activeProjectPath}
                          >
                            {busy ? (
                              <>
                                <div className="bm-inline-spinner" />
                                Fixing...
                              </>
                            ) : (
                              <>Remove obsolete i2c</>
                            )}
                          </button>
                        )}
                        <button
                          className={`bm-btn ${busy ? "bm-btn--progress" : "bm-btn--install"}`}
                          style={{ background: 'var(--ide-accent)' }}
                          onClick={async () => {
                            if (!activeProjectPath) return;
                            setDiagnosticBusy(prev => ({ ...prev, [key]: true }));
                            try {
                              if (isMissingCrate) {
                                await invoke("add_crate_to_cargo", {
                                  projectPath: activeProjectPath,
                                  crateName: diag.crate_name
                                });
                                addLog(`✓ Fixed: Installed crate '${diag.crate_name}'`);
                              } else {
                                await invoke("add_feature_to_cargo", {
                                  projectPath: activeProjectPath,
                                  crateName: diag.crate_name,
                                  feature: diag.missing_feature
                                });
                                addLog(`✓ Fixed: Added feature '${diag.missing_feature}' to ${diag.crate_name}`);
                              }
                              // Remove from list
                              setFeatureDiagnostics(featureDiagnostics.filter((_, i) => i !== idx));
                              // Auto refresh installed tab quietly
                              fetchInstalled();
                            } catch (e) {
                              addLog(`[Error] Failed to fix: ${e}`);
                            } finally {
                              setDiagnosticBusy(prev => {
                                const n = { ...prev };
                                delete n[key];
                                return n;
                              });
                            }
                          }}
                          disabled={busy || !activeProjectPath}
                        >
                          {busy ? (
                            <>
                              <div className="bm-progress-fill" style={{ width: '100%' }} />
                              <span className="bm-progress-text">Fixing...</span>
                            </>
                          ) : (
                            <>
                              <AutoFixHighIcon sx={{ fontSize: 14 }} />
                              FIX
                            </>
                          )}
                        </button>
                      </div>
                      {busy && (
                        <div className="bm-progress-bar">
                          <div className="bm-progress-bar-fill bm-progress-bar-fill--indeterminate" />
                        </div>
                      )}
                    </div>
                  )})}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
