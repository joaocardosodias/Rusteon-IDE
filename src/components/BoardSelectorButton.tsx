import { useIDEStore } from '../store/useIDEStore';
import DeveloperBoardIcon from '@mui/icons-material/DeveloperBoard';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';

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
      title="Select Board / Port"
      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px' }}
    >
      {/* Board icon */}
      <DeveloperBoardIcon sx={{ fontSize: 18, color: 'var(--ide-accent)', flexShrink: 0 }} />

      {/* Text block */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{
          fontSize: '13px',
          fontWeight: 700,
          color: '#d4d4d4',
          letterSpacing: '0.2px',
        }}>
          {activeBoard}
        </span>
      </div>

      {/* Chevron */}
      <KeyboardArrowDownIcon sx={{ fontSize: 16, color: '#6a6c6e', flexShrink: 0, marginLeft: '2px' }} />
    </button>
  );
}
