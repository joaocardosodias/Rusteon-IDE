import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SerialPortDialogProps } from '../types/board-selector';
import UsbIcon from '@mui/icons-material/Usb';
import DeveloperBoardIcon from '@mui/icons-material/DeveloperBoard';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

export function SerialPortDialog({ open, onClose, onPortSelected, onOpenBoardPortDialog }: SerialPortDialogProps & { onOpenBoardPortDialog?: () => void }) {
  const [ports, setPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    const fetchPorts = async (showLoading: boolean) => {
      if (showLoading) {
        setLoading(true);
        setError(null);
      }
      try {
        const portList = await invoke<string[]>('get_serial_ports');
        setPorts((prev) => {
          if (JSON.stringify(prev) !== JSON.stringify(portList)) {
            return portList;
          }
          return prev;
        });
      } catch (err) {
        if (showLoading) setError(err as string);
      } finally {
        if (showLoading) setLoading(false);
      }
    };

    if (open) {
      fetchPorts(true);
      interval = setInterval(() => {
        fetchPorts(false);
      }, 1000);
      setSelectedPort(null);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose]);

  const handlePortClick = (port: string) => {
    setSelectedPort(port);
    onPortSelected(port);
    // Also open the full board+port dialog
    onClose();
    if (onOpenBoardPortDialog) onOpenBoardPortDialog();
  };

  if (!open) return null;

  return (
    <div
      ref={dropdownRef}
      className="absolute dialog-dropdown"
      style={{
        width: '320px',
        maxHeight: '400px',
        zIndex: 1000,
        top: '100%',
        left: 0,
        marginTop: '6px',
        backgroundColor: '#2b3036',
        border: '1px solid var(--ide-teal)',
        borderRadius: '8px',
        boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}
    >
      {/* Header acting as "Select Board" */}
      <div 
        className="dialog-header-alt flex justify-between items-center cursor-pointer hover:bg-opacity-80 transition-colors"
        onClick={onClose}
        style={{ 
          padding: '10px 14px', 
          borderBottom: '1px solid var(--ide-teal-dim)',
          backgroundColor: '#2b3036'
        }}
      >
        <span style={{ fontSize: '14px', color: '#e0e2e5' }}>Select Board</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#e0e2e5" strokeWidth="2.5">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>

      {/* Content */}
      <div className="overflow-auto" style={{ maxHeight: '320px' }}>
        {loading && (
          <div className="dialog-empty">
            <UsbIcon sx={{ fontSize: 40, color: '#555', marginBottom: '8px' }} />
            <p className="dialog-empty-sub" style={{ color: '#e0e2e5' }}>
              Searching ports...
            </p>
          </div>
        )}

        {error && (
          <div className="p-4">
            <div
              className="flex items-start gap-2 p-3 rounded text-xs mb-3"
              style={{ backgroundColor: 'rgba(224, 108, 117, 0.1)', color: '#e06c75' }}
            >
              <span>⚠</span>
              <span>{error}</span>
            </div>
            <button
              onClick={() => {}}
              className="dialog-btn-primary w-full"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              <RefreshIcon sx={{ fontSize: 14 }} />
              Try Again
            </button>
          </div>
        )}

        {!loading && !error && ports.length === 0 && (
          <div className="dialog-empty">
            <DeveloperBoardIcon sx={{ fontSize: 48, color: '#555', marginBottom: '10px' }} />
            <p className="dialog-empty-text" style={{ color: '#e0e2e5' }}>
              No devices found
            </p>
            <p className="dialog-empty-sub mb-3" style={{ color: '#888' }}>
              Connect via USB
            </p>
            {/* Refreshing is automatic, no button needed unless error */}
          </div>
        )}

        {!loading && !error && ports.length > 0 && (
          <div className="flex flex-col">
            {ports.map((port) => {
              const isActive = selectedPort === port;
              return (
                <button
                  key={port}
                  onClick={() => handlePortClick(port)}
                  className="flex items-center gap-4 text-left transition-colors"
                  style={{
                    padding: '12px 14px',
                    borderBottom: '1px solid var(--ide-teal-dim)',
                    backgroundColor: isActive ? 'rgba(0, 151, 157, 0.1)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  <UsbIcon sx={{ fontSize: 22, color: isActive ? '#fff' : '#a0a2a5', flexShrink: 0 }} />
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div style={{ fontSize: '14px', color: '#e0e2e5', letterSpacing: '0.2px' }}>Serial Device</div>
                    <div style={{ fontSize: '12px', color: '#a0a2a5' }}>{port}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Footer Item */}
        {!loading && !error && (
          <button
            className="w-full text-left transition-colors"
            style={{
              padding: '12px 16px',
              fontSize: '12.5px',
              color: '#00979d',
              backgroundColor: 'transparent',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderTop: '1px solid rgba(0,151,157,0.15)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(0,151,157,0.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            onClick={() => {
              onClose();
              if (onOpenBoardPortDialog) onOpenBoardPortDialog();
            }}
          >
            <OpenInNewIcon sx={{ fontSize: 14 }} />
            Select other board and port...
          </button>
        )}
      </div>
    </div>
  );
}
