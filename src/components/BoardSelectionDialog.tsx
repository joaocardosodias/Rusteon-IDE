import { useEffect, useRef } from 'react';
import { BoardSelectionDialogProps } from '../types/board-selector';
import DeveloperBoardIcon from '@mui/icons-material/DeveloperBoard';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

export function BoardSelectionDialog({ open, onClose }: BoardSelectionDialogProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  if (!open) return null;

  return (
    <div
      ref={dropdownRef}
      className="absolute dialog-dropdown"
      style={{
        width: '360px',
        zIndex: 1000,
        top: '100%',
        left: 0,
        marginTop: '6px',
      }}
    >
      {/* Header */}
      <div className="dialog-header">
        <h3 className="dialog-title">
          Selecionar Placa
        </h3>
      </div>

      {/* Content */}
      <div className="dialog-content">
        <div className="dialog-empty">
          <DeveloperBoardIcon sx={{ fontSize: 48, color: 'var(--ide-text-faint)', marginBottom: '12px' }} />
          <p className="dialog-empty-text">
            Nenhuma placa disponível
          </p>
          <p className="dialog-empty-sub">
            Instale placas através do Board Manager
          </p>
          <button
            className="dialog-btn-primary"
            onClick={onClose}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <OpenInNewIcon sx={{ fontSize: 14 }} />
            Abrir Board Manager
          </button>
        </div>
      </div>
    </div>
  );
}
