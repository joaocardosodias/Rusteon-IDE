import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useIDEStore } from '../store/useIDEStore';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import CheckIcon from '@mui/icons-material/Check';
import DeveloperBoardIcon from '@mui/icons-material/DeveloperBoard';
import UsbIcon from '@mui/icons-material/Usb';

interface BoardPortDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (board: string, port: string | null) => void;
}

import { BOARDS } from '../data/boards';

export function BoardPortDialog({ open, onClose, onConfirm }: BoardPortDialogProps) {
  const { selectedBoard, selectedPort, setSelectedBoard, setSelectedPort } = useIDEStore();

  const [boardSearch, setBoardSearch] = useState('');
  const [tempBoard, setTempBoard] = useState<string | null>(selectedBoard);
  const [tempPort, setTempPort]   = useState<string | null>(selectedPort);
  const [ports, setPorts]         = useState<string[]>([]);
  const [showAll, setShowAll]     = useState(false);
  const [installedTargets, setInstalledTargets] = useState<string[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-refresh ports every second
  useEffect(() => {
    if (!open) return;

    const fetchPorts = async () => {
      try {
        const list = await invoke<string[]>('get_serial_ports');
        setPorts((prev) =>
          JSON.stringify(prev) !== JSON.stringify(list) ? list : prev
        );
      } catch { /* ignore */ }
    };

    fetchPorts();
    intervalRef.current = setInterval(fetchPorts, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [open]);

  // Fetch installed targets
  useEffect(() => {
    if (!open) return;
    invoke<{ installed_targets: string[] }>('check_installed_targets')
      .then(res => setInstalledTargets(res.installed_targets))
      .catch(err => console.error("Falha ao checar boards:", err));
  }, [open]);

  // Reset temp state when opening
  useEffect(() => {
    if (open) {
      setTempBoard(selectedBoard);
      setTempPort(selectedPort);
      setBoardSearch('');
    }
  }, [open, selectedBoard, selectedPort]);

  const filteredBoards = BOARDS.filter(
    (b) =>
      b.name.toLowerCase().includes(boardSearch.toLowerCase()) ||
      b.vendor.toLowerCase().includes(boardSearch.toLowerCase())
  );

  const handleOk = () => {
    if (!tempBoard) return;
    setSelectedBoard(tempBoard);
    setSelectedPort(tempPort);
    onConfirm(tempBoard, tempPort);
    onClose();
  };

  if (!open) return null;

  return (
    /* Backdrop */
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.65)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'dialogFadeIn 150ms ease-out',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Dialog box */}
      <div
        style={{
          width: '680px',
          maxHeight: '540px',
          backgroundColor: '#1e2227',
          border: '1px solid #3a3f4b',
          borderRadius: '8px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: '1px solid #2a2f3b',
          backgroundColor: '#252930',
        }}>
          <span style={{ fontSize: '15px', fontWeight: 700, color: '#d4d4d4', letterSpacing: '0.2px' }}>
            Select Other Board and Port
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: '#666', display: 'flex', alignItems: 'center', padding: '2px',
              borderRadius: '4px', transition: 'color 120ms ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#aaa')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#666')}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </button>
        </div>

        {/* Subtitle */}
        <div style={{
          padding: '10px 18px',
          borderBottom: '1px solid #1a1d22',
          backgroundColor: '#1e2227',
        }}>
          <p style={{ fontSize: '12px', color: '#888', lineHeight: 1.6 }}>
            Select both a <strong style={{ color: '#aaa' }}>Board</strong> and a <strong style={{ color: '#aaa' }}>Port</strong> if you want to upload a sketch.<br />
            If you only select a Board you will be able to compile, but not to upload your sketch.
          </p>
        </div>

        {/* Two-column body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* ── BOARDS column ── */}
          <div style={{
            width: '50%',
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid #2a2f3b',
          }}>
            <div style={{
              padding: '10px 12px 8px',
              borderBottom: '1px solid #2a2f3b',
              backgroundColor: '#252930',
            }}>
              <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#00979d', letterSpacing: '1px', textTransform: 'uppercase' }}>
                Boards
              </span>
            </div>

            {/* Search */}
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #1a1d22' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: '#161a1e', border: '1px solid #383d49',
                borderRadius: '5px', padding: '5px 10px',
              }}>
                <SearchIcon sx={{ fontSize: 14, color: '#555' }} />
                <input
                  value={boardSearch}
                  onChange={(e) => setBoardSearch(e.target.value)}
                  placeholder="Search board"
                  autoFocus
                  style={{
                    flex: 1, background: 'transparent', border: 'none',
                    outline: 'none', fontSize: '12px', color: '#ccc',
                  }}
                />
              </div>
            </div>

            {/* Board list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredBoards.length === 0 ? (
                <div style={{
                  padding: '20px 16px', textAlign: 'center',
                  color: '#555', fontSize: '12px',
                }}>
                  NO BOARDS FOUND FOR "{boardSearch}"
                </div>
              ) : (
                filteredBoards.map((board) => {
                  const isActive = tempBoard === board.id;
                  const isInstalled = installedTargets.includes(board.target);
                  return (
                    <button
                      key={board.id}
                      onClick={() => setTempBoard(board.id)}
                      style={{
                        width: '100%', textAlign: 'left', padding: '9px 14px',
                        border: 'none', cursor: 'pointer',
                        backgroundColor: isActive ? 'rgba(255, 158, 0, 0.15)' : 'transparent',
                        borderLeft: `3px solid ${isActive ? 'var(--ide-accent)' : 'transparent'}`,
                        display: 'flex', alignItems: 'center', gap: '10px',
                        transition: 'background 120ms ease',
                        opacity: isInstalled ? 1 : 0.45,
                      }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <DeveloperBoardIcon sx={{ fontSize: 16, color: isActive ? '#00979d' : '#555', flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: '12.5px', fontWeight: 600, color: isActive ? '#cdd6f4' : '#bbb' }}>
                          {board.name}
                          {!isInstalled && (
                            <span style={{
                              fontSize: '9px',
                              marginLeft: '8px',
                              backgroundColor: 'rgba(255,255,255,0.1)',
                              color: '#aaa',
                              padding: '2px 4px',
                              borderRadius: '3px',
                              fontWeight: 500
                            }}>
                              NOT INSTALLED
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '10.5px', color: '#555', marginTop: '1px' }}>
                          {board.vendor}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ── PORTS column ── */}
          <div style={{ width: '50%', display: 'flex', flexDirection: 'column' }}>
            <div style={{
              padding: '10px 12px 8px',
              borderBottom: '1px solid #2a2f3b',
              backgroundColor: '#252930',
            }}>
              <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#00979d', letterSpacing: '1px', textTransform: 'uppercase' }}>
                Ports
              </span>
            </div>

            {/* Port list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {ports.length === 0 ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', height: '100%',
                  color: '#444', fontSize: '12px', gap: '8px',
                }}>
                  <UsbIcon sx={{ fontSize: 32, color: '#333' }} />
                  <span>Nenhuma porta detectada</span>
                  <span style={{ fontSize: '10px', color: '#333' }}>Conecte um dispositivo via USB</span>
                </div>
              ) : (
                ports.map((port) => {
                  const isActive = tempPort === port;
                  const isUSB = port.toLowerCase().includes('usb');
                  return (
                    <button
                      key={port}
                      onClick={() => setTempPort(isActive ? null : port)}
                      style={{
                        width: '100%', textAlign: 'left', padding: '10px 14px',
                        border: 'none', cursor: 'pointer',
                        backgroundColor: isActive ? 'rgba(255, 158, 0, 0.15)' : 'transparent',
                        borderBottom: '1px solid #1a1d22',
                        display: 'flex', alignItems: 'center', gap: '10px',
                        transition: 'background 120ms ease',
                      }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <UsbIcon sx={{ fontSize: 16, color: isActive ? '#00979d' : '#555', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '12.5px', color: isActive ? '#cdd6f4' : '#bbb' }}>
                          {port} {isUSB ? 'Serial Port (USB)' : 'Serial Port'}
                        </div>
                      </div>
                      {isActive && (
                        <CheckIcon sx={{ fontSize: 15, color: '#00979d' }} />
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Show all ports checkbox */}
            <div style={{
              padding: '10px 14px',
              borderTop: '1px solid #2a2f3b',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <input
                id="show-all-ports"
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
                style={{ cursor: 'pointer', accentColor: '#00979d' }}
              />
              <label htmlFor="show-all-ports" style={{ fontSize: '12px', color: '#888', cursor: 'pointer' }}>
                Show all ports
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 18px',
          borderTop: '1px solid #2a2f3b',
          backgroundColor: '#252930',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          {/* Status message */}
          <span style={{ fontSize: '11.5px', color: '#666' }}>
            {!tempBoard
              ? 'Please pick a board to continue.'
              : !tempPort
              ? 'Please pick a board connected to the port you have selected.'
              : `Ready to upload to ${BOARDS.find(b => b.id === tempBoard)?.name || tempBoard}`
            }
          </span>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onClose}
              style={{
                padding: '6px 18px', borderRadius: '5px', fontSize: '12.5px',
                fontWeight: 600, cursor: 'pointer', border: '1px solid #444',
                backgroundColor: 'transparent', color: '#aaa',
                transition: 'background 120ms ease, border-color 120ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#2a2f3b';
                e.currentTarget.style.borderColor = '#555';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.borderColor = '#444';
              }}
            >
              CANCEL
            </button>
            <button
              onClick={handleOk}
              disabled={!tempBoard}
              style={{
                padding: '6px 22px', borderRadius: '5px', fontSize: '12.5px',
                fontWeight: 700, cursor: tempBoard ? 'pointer' : 'not-allowed',
                border: 'none',
                backgroundColor: tempBoard ? '#00979d' : '#1e5f63',
                color: '#fff',
                opacity: tempBoard ? 1 : 0.6,
                transition: 'background 120ms ease',
              }}
              onMouseEnter={(e) => { if (tempBoard) e.currentTarget.style.backgroundColor = '#00b3ba'; }}
              onMouseLeave={(e) => { if (tempBoard) e.currentTarget.style.backgroundColor = '#00979d'; }}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
