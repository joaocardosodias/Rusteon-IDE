export interface SerialPortDialogProps {
  open: boolean;
  onClose: () => void;
  onPortSelected: (port: string) => void;
}

export interface BoardSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  onBoardSelected: (board: string) => void;
}

export interface BoardSelectorState {
  // Dialog states
  serialDialogOpen: boolean;
  boardDialogOpen: boolean;
  boardPortDialogOpen: boolean;
  
  // Selected values
  selectedPort: string | null;
  selectedBoard: string | null;
  
  // Actions
  setSerialDialogOpen: (open: boolean) => void;
  setBoardDialogOpen: (open: boolean) => void;
  setBoardPortDialogOpen: (open: boolean) => void;
  setSelectedPort: (port: string | null) => void;
  setSelectedBoard: (board: string | null) => void;
}
