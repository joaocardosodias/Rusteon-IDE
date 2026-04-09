import { useIDEStore } from '../store/useIDEStore';
import DeveloperBoardIcon from '@mui/icons-material/DeveloperBoard';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import CircleIcon from '@mui/icons-material/Circle';

interface BoardSelectorButtonProps {
  activeBoard: string;
}

export function BoardSelectorButton({ activeBoard }: BoardSelectorButtonProps) {
  const setSerialDialogOpen = useIDEStore((state) => state.setSerialDialogOpen);
  const selectedPort = useIDEStore((state) => state.selectedPort);

  return (
    <button
      onClick={() => setSerialDialogOpen(true)}
      className="board-selector"
      title="Selecionar Placa / Porta"
    >
      {/* Board icon */}
      <DeveloperBoardIcon sx={{ fontSize: 15, color: 'var(--ide-teal)', flexShrink: 0 }} />

      {/* Text block */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: '110px' }}>
        <span style={{
          fontSize: '12.5px',
          fontWeight: 700,
          color: '#d4d4d4',
          letterSpacing: '0.2px',
          lineHeight: 1.2,
        }}>
          {activeBoard}
        </span>
        <span style={{
          fontSize: '10px',
          color: selectedPort ? '#6a9f6c' : '#555',
          lineHeight: 1.3,
          marginTop: '1px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}>
          <CircleIcon sx={{ fontSize: 6, color: selectedPort ? '#6a9f6c' : '#3a3f4b' }} />
          {selectedPort || 'no port selected'}
        </span>
      </div>

      {/* Chevron */}
      <KeyboardArrowDownIcon sx={{ fontSize: 15, color: '#555', flexShrink: 0 }} />
    </button>
  );
}
