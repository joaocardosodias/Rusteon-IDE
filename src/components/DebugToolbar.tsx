import { useDebugStore } from "../store/useDebugStore";
import { DapClient } from "../api/dapClient";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import RedoIcon from "@mui/icons-material/Redo";
import SubdirectoryArrowRightIcon from "@mui/icons-material/SubdirectoryArrowRight";
import StopIcon from "@mui/icons-material/Stop";

export function DebugToolbar() {
  const state = useDebugStore((state) => state.state);

  if (state !== "running" && state !== "paused") {
    return null;
  }

  const handleContinue = () => {
    if (state === "paused") {
      DapClient.continue();
    }
  };

  const handleStepOver = () => {
    if (state === "paused") {
      DapClient.next();
    }
  };

  const handleStepInto = () => {
    if (state === "paused") {
      DapClient.stepIn();
    }
  };

  const handleStop = () => {
    // This could also kill the debug session
    // Usually triggering the backend 'stop_debug_session' invoke does this
  };

  return (
    <div className="debug-toolbar">
      <button 
        className="dt-btn" 
        onClick={handleContinue} 
        disabled={state === "running"} 
        title="Continue (F5)"
      >
        {state === "paused" ? <PlayArrowIcon sx={{ fontSize: 18, color: "#8be9fd" }} /> : <PauseIcon sx={{ fontSize: 18, color: "#aaa" }} />}
      </button>
      <button 
        className="dt-btn" 
        onClick={handleStepOver} 
        disabled={state === "running"}
        title="Step Over (F10)"
      >
        <RedoIcon sx={{ fontSize: 18, color: "#f1fa8c" }} />
      </button>
      <button 
        className="dt-btn" 
        onClick={handleStepInto} 
        disabled={state === "running"}
        title="Step Into (F11)"
      >
        <SubdirectoryArrowRightIcon sx={{ fontSize: 18, color: "#50fa7b" }} />
      </button>
      <button 
        className="dt-btn" 
        onClick={handleStop} 
        title="Stop (Shift+F5)"
      >
        <StopIcon sx={{ fontSize: 18, color: "#ff5555" }} />
      </button>
    </div>
  );
}
