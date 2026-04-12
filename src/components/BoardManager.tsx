import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { BOARDS, ARCH_LABELS, ARCH_COLORS, type BoardDefinition } from '../data/boards';
import DeveloperBoardIcon from '@mui/icons-material/DeveloperBoardOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import MemoryIcon from '@mui/icons-material/Memory';
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useIDEStore } from '../store/useIDEStore';

type InstallStatus = 'idle' | 'checking' | 'installing' | 'installed' | 'removing' | 'error';

interface BoardState {
  status: InstallStatus;
  progress: number;
  error?: string;
}

interface BoardInstallState {
  installed_targets: string[];
  espup_installed: boolean;
}

interface InstallProgress {
  target: string;
  line: string;
  stream: string;
}

interface InstallComplete {
  target: string;
  success: boolean;
  message: string;
}

export function BoardManager() {
  const [filter, setFilter] = useState('');
  const [boardStates, setBoardStates] = useState<Record<string, BoardState>>(() => {
    const initial: Record<string, BoardState> = {};
    BOARDS.forEach((b) => {
      initial[b.id] = { status: 'checking', progress: 0 };
    });
    return initial;
  });
  const [collapsedVendors, setCollapsedVendors] = useState<Set<string>>(new Set());
  const [espupAvailable, setEspupAvailable] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // ── Load installed state on mount ──
  const loadInstalledState = useCallback(async () => {
    try {
      const state = await invoke<BoardInstallState>('check_installed_targets');
      setEspupAvailable(state.espup_installed);

      setBoardStates((prev) => {
        const next = { ...prev };
        BOARDS.forEach((b) => {
          const isInstalled = state.installed_targets.includes(b.target);
          if (next[b.id].status === 'checking' || next[b.id].status === 'idle') {
            next[b.id] = {
              ...next[b.id],
              status: isInstalled ? 'installed' : 'idle',
              progress: isInstalled ? 100 : 0,
            };
          }
        });
        return next;
      });
      setLoaded(true);
    } catch (err) {
      console.error('Failed to check installed targets:', err);
      setBoardStates((prev) => {
        const next = { ...prev };
        BOARDS.forEach((b) => {
          if (next[b.id].status === 'checking') {
            next[b.id] = { ...next[b.id], status: 'idle' };
          }
        });
        return next;
      });
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadInstalledState();
  }, [loadInstalledState]);

  // ── Listen to Tauri events for install streaming ──
  useEffect(() => {
    let unlistenProgress: UnlistenFn | undefined;
    let unlistenComplete: UnlistenFn | undefined;

    const setup = async () => {
      unlistenProgress = await listen<InstallProgress>('install-progress', (event) => {
        // Log streaming disabled as per user request
      });

      unlistenComplete = await listen<InstallComplete>('install-complete', (event) => {
        const { target, success, message } = event.payload;
        const board = BOARDS.find((b) => b.target === target);
        if (!board) return;

        setBoardStates((prev) => ({
          ...prev,
          [board.id]: {
            ...prev[board.id],
            status: success ? 'installed' : 'error',
            progress: success ? 100 : 0,
            error: success ? undefined : message,
          },
        }));
      });
    };

    setup();
    return () => {
      unlistenProgress?.();
      unlistenComplete?.();
    };
  }, []);

  // ── Auto-scroll log removed ──

  // ── Filtering ──
  const filteredBoards = BOARDS.filter(
    (b) =>
      b.name.toLowerCase().includes(filter.toLowerCase()) ||
      b.chip.toLowerCase().includes(filter.toLowerCase()) ||
      b.vendor.toLowerCase().includes(filter.toLowerCase()) ||
      b.target.toLowerCase().includes(filter.toLowerCase())
  );

  const filteredGrouped: Record<string, BoardDefinition[]> = {};
  for (const b of filteredBoards) {
    if (!filteredGrouped[b.vendor]) filteredGrouped[b.vendor] = [];
    filteredGrouped[b.vendor].push(b);
  }

  const toggleVendor = (vendor: string) => {
    setCollapsedVendors((prev) => {
      const next = new Set(prev);
      if (next.has(vendor)) next.delete(vendor);
      else next.add(vendor);
      return next;
    });
  };

  // ── Install (real backend) ──
  const handleInstall = async (board: BoardDefinition) => {
    const state = boardStates[board.id];
    if (state.status === 'installing' || state.status === 'installed') return;

    setBoardStates((prev) => ({
      ...prev,
      [board.id]: { status: 'installing', progress: 10 },
    }));

    try {
      await invoke<string>('install_board_target', {
        target: board.target,
        method: board.installMethod,
        espupTargets: board.espupTargets || null,
      });
    } catch (err) {
      setBoardStates((prev) => ({
        ...prev,
        [board.id]: {
          ...prev[board.id],
          status: 'error',
          progress: 0,
          error: String(err),
        },
      }));
    }
  };

  // ── Remove (real backend) ──
  const handleRemove = async (board: BoardDefinition) => {
    const state = boardStates[board.id];
    if (state.status !== 'installed') return;

    setBoardStates((prev) => ({
      ...prev,
      [board.id]: { status: 'removing', progress: 50 },
    }));

    try {
      await invoke<string>('remove_board_target', {
        target: board.target,
      });
      setBoardStates((prev) => ({
        ...prev,
        [board.id]: { status: 'idle', progress: 0 },
      }));
    } catch (err) {
      setBoardStates((prev) => ({
        ...prev,
        [board.id]: {
          ...prev[board.id],
          status: 'error',
          progress: 0,
          error: String(err),
        },
      }));
    }
  };

  // ── Retry ──
  const handleRetry = (board: BoardDefinition) => {
    setBoardStates((prev) => ({
      ...prev,
      [board.id]: { status: 'idle', progress: 0, error: undefined },
    }));
  };

  const vendorOrder = Object.keys(filteredGrouped).sort();

  return (
    <div className="board-manager">

      {/* Search */}
      <div className="bm-search-wrap">
        <input
          id="board-search"
          type="text"
          placeholder="Filter boards..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bm-search"
          autoComplete="off"
        />
      </div>

      {/* Board List */}
      <div className="bm-list">
        {!loaded && (
          <div className="bm-empty">
            <div className="bm-loading-spinner" />
            <p>Checking toolchains...</p>
          </div>
        )}

        {loaded && vendorOrder.length === 0 && (
          <div className="bm-empty">
            <MemoryIcon sx={{ fontSize: 32, opacity: 0.3 }} />
            <p>No boards found</p>
          </div>
        )}

        {loaded && vendorOrder.map((vendor) => {
          const boards = filteredGrouped[vendor];
          const isCollapsed = collapsedVendors.has(vendor);

          return (
            <div key={vendor} className="bm-vendor-group">
              <button
                className="bm-vendor-header"
                onClick={() => toggleVendor(vendor)}
              >
                <span className="bm-vendor-name">{vendor}</span>
                <span className="bm-vendor-count">{boards.length}</span>
                {isCollapsed
                  ? <ExpandMoreIcon sx={{ fontSize: 16, color: '#555' }} />
                  : <ExpandLessIcon sx={{ fontSize: 16, color: '#555' }} />
                }
              </button>

              {!isCollapsed && boards.map((board) => {
                const state = boardStates[board.id];
                const archColor = ARCH_COLORS[board.arch];
                const needsEspup = board.installMethod === 'espup' && !espupAvailable;

                return (
                  <div key={board.id} className="bm-card" id={`board-${board.id}`}>

                    <div className="bm-card-header">
                      <DeveloperBoardIcon sx={{ fontSize: 18, color: archColor, flexShrink: 0 }} />
                      <div className="bm-card-info">
                        <div className="bm-card-name">{board.name}</div>
                        <div className="bm-card-meta">
                          <span
                            className="bm-arch-badge"
                            style={{ color: archColor, borderColor: archColor }}
                          >
                            {ARCH_LABELS[board.arch]}
                          </span>
                          <span className="bm-card-target">{board.chip}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bm-card-desc">{board.description}</div>

                    <div className="bm-card-details">
                      <span className="bm-detail-tag">
                        <code>{board.target}</code>
                      </span>
                      <span className="bm-detail-tag">
                        {board.hal} v{board.halVersion}
                      </span>
                      {board.installMethod === 'espup' && (
                        <span className="bm-detail-tag" style={{ color: '#e5c07b' }}>
                          via espup
                        </span>
                      )}
                    </div>

                    <div className="bm-card-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        className="bm-btn-ghost"
                        onClick={() => openUrl(board.infoUrl)}
                        title="Official Site / More Info"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', color: 'var(--ide-accent)', background: 'rgba(255, 158, 0, 0.1)', border: '1px solid rgba(255, 158, 0, 0.3)', cursor: 'pointer', borderRadius: '4px' }}
                      >
                        <InfoOutlinedIcon sx={{ fontSize: 15 }} />
                      </button>

                      <select className="bm-version-select" onChange={(e) => {
                        if (e.target.value === 'other') {
                          useIDEStore.getState().showAlert("Notice", `Additional version manager for ${board.name} will be available in future updates.`);
                          e.target.value = board.halVersion;
                        }
                      }}>
                        <option value={board.halVersion}>v{board.halVersion} (Current)</option>
                        <option value="other">Download other versions...</option>
                      </select>

                      {state.status === 'checking' ? (
                        <button className="bm-btn bm-btn--progress" disabled>
                          <span className="bm-progress-text">Checking...</span>
                        </button>
                      ) : state.status === 'installed' ? (
                        <div className="bm-action-group">
                          <button className="bm-btn bm-btn--installed" disabled>
                            <CheckCircleIcon sx={{ fontSize: 13 }} />
                            INSTALLED
                          </button>
                          <button
                            className="bm-btn bm-btn--remove"
                            onClick={() => handleRemove(board)}
                            title="Remove target"
                          >
                            <DeleteOutlinedIcon sx={{ fontSize: 14 }} />
                          </button>
                        </div>
                      ) : state.status === 'installing' ? (
                        <button className="bm-btn bm-btn--progress" disabled>
                          <div className="bm-progress-fill" style={{ width: '100%' }} />
                          <span className="bm-progress-text">Installing...</span>
                        </button>
                      ) : state.status === 'removing' ? (
                        <button className="bm-btn bm-btn--removing" disabled>
                          Removing...
                        </button>
                      ) : state.status === 'error' ? (
                        <div className="bm-action-group">
                          <button className="bm-btn bm-btn--error" disabled>
                            <ErrorOutlinedIcon sx={{ fontSize: 13 }} />
                            FAILED
                          </button>
                          <button
                            className="bm-btn bm-btn--install"
                            onClick={() => handleRetry(board)}
                          >
                            RETRY
                          </button>
                        </div>
                      ) : (
                        <button
                          className="bm-btn bm-btn--install"
                          onClick={() => handleInstall(board)}
                          id={`install-board-${board.id}`}
                          disabled={needsEspup}
                          title={needsEspup ? 'espup not found. Install with: cargo install espup' : undefined}
                        >
                          <DownloadIcon sx={{ fontSize: 13 }} />
                          {needsEspup ? 'NEED ESPUP' : 'INSTALL'}
                        </button>
                      )}
                    </div>

                    {/* Progress bar (installing) */}
                    {state.status === 'installing' && (
                      <div className="bm-progress-bar">
                        <div className="bm-progress-bar-fill bm-progress-bar-fill--indeterminate" />
                      </div>
                    )}

                    {/* Error message */}
                    {state.status === 'error' && state.error && (
                      <div className="bm-error-msg">
                        {state.error}
                      </div>
                    )}

                    {/* Local log section removed as per user request */}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
