/**
 * Remove ANSI CSI escape sequences (colors, bold, etc.) from serial / log lines.
 * Typical output: \u001b[32mINFO ...\u001b[0m
 */
const ANSI_CSI =
  // eslint-disable-next-line no-control-regex
  /\u001b\[[\d;?]*[ -/]*[@-~]/g;

/** OSC sequences (e.g. hyperlinks, window titles) */
const ANSI_OSC =
  // eslint-disable-next-line no-control-regex
  /\u001b\][\d;]*(?:[^\u0007\u001b]*\u0007|\u001b\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_OSC, "").replace(ANSI_CSI, "");
}
