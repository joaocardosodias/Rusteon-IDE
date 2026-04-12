import { 
  VscFolder, 
  VscFolderOpened, 
  VscFile, 
  VscMarkdown, 
  VscJson, 
  VscLock,
  VscSettingsGear,
  VscFileBinary
} from "react-icons/vsc";
import { DiRust, DiTerminal } from "react-icons/di";
import { SiYaml, SiToml, SiDocker, SiGithub } from "react-icons/si";

export interface IconInfo {
  icon: JSX.Element;
  color: string;
}

export const getFileIcon = (name: string, isDir: boolean, expanded: boolean): IconInfo => {
  const lowerName = name.toLowerCase();
  
  if (isDir) {
    if (lowerName === "src") return { icon: <VscFolderOpened />, color: "#ff9e00" };
    if (lowerName === "target" || lowerName === "build") return { icon: <VscFolder />, color: "#5c6370" };
    if (lowerName === ".git") return { icon: <SiGithub />, color: "#f05032" };
    if (lowerName === "examples") return { icon: <VscFolder />, color: "#60a5fa" };
    
    return { 
      icon: expanded ? <VscFolderOpened /> : <VscFolder />, 
      color: "#ffca28" 
    };
  }

  if (lowerName.endsWith(".rs")) return { icon: <DiRust />, color: "#dea54b" };
  if (lowerName === "cargo.toml") return { icon: <SiToml />, color: "#e06c75" };
  if (lowerName.endsWith(".toml")) return { icon: <VscSettingsGear />, color: "#888" };
  if (lowerName.endsWith(".md")) return { icon: <VscMarkdown />, color: "#007acc" };
  if (lowerName.endsWith(".json")) return { icon: <VscJson />, color: "#cbcb41" };
  if (lowerName.endsWith(".lock")) return { icon: <VscLock />, color: "#888" };
  if (lowerName.endsWith(".yml") || lowerName.endsWith(".yaml")) return { icon: <SiYaml />, color: "#cb2431" };
  if (lowerName.includes("docker")) return { icon: <SiDocker />, color: "#2496ed" };
  if (lowerName === ".gitignore") return { icon: <SiGithub />, color: "#f05032" };
  if (lowerName.endsWith(".sh") || lowerName.endsWith(".bat")) return { icon: <DiTerminal />, color: "#4d5a5e" };
  if (lowerName.endsWith(".bin") || lowerName.endsWith(".hex") || lowerName.endsWith(".elf")) return { icon: <VscFileBinary />, color: "#4d5a5e" };

  return { icon: <VscFile />, color: "#9da5b4" };
};
