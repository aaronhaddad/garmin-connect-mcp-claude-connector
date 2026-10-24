import { spawn, spawnSync } from "node:child_process";

/** Opens a URL in the default browser. Resolves false if no opener exists (e.g. SSH session). */
export function openUrl(url: string): Promise<boolean> {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args as string[], { stdio: "ignore", detached: true });
      child.on("error", () => resolve(false));
      child.on("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

const CLIPBOARD_READERS: [string, string[]][] =
  process.platform === "darwin"
    ? [["pbpaste", []]]
    : process.platform === "win32"
      ? [["powershell", ["-NoProfile", "-Command", "Get-Clipboard"]]]
      : [
          ["wl-paste", ["--no-newline"]],
          ["xclip", ["-selection", "clipboard", "-o"]],
          ["xsel", ["--clipboard", "--output"]],
        ];

export function readClipboard(): string | undefined {
  for (const [cmd, args] of CLIPBOARD_READERS) {
    const res = spawnSync(cmd, args, { encoding: "utf8" });
    if (res.status === 0) return res.stdout.trim() || undefined;
  }
  return undefined;
}

export const canReadClipboard = () => CLIPBOARD_READERS.some(([cmd]) => spawnSync(process.platform === "win32" ? "where" : "sh", process.platform === "win32" ? [cmd] : ["-c", `command -v ${cmd}`]).status === 0);

export function clearClipboard(): boolean {
  const writers: [string, string[]][] =
    process.platform === "darwin"
      ? [["pbcopy", []]]
      : process.platform === "win32"
        ? [["powershell", ["-NoProfile", "-Command", "Set-Clipboard -Value $null"]]]
        : [
            ["wl-copy", ["--clear"]],
            ["xclip", ["-selection", "clipboard"]],
            ["xsel", ["--clipboard", "--clear"]],
          ];
  for (const [cmd, args] of writers) {
    if (spawnSync(cmd, args, { input: "" }).status === 0) return true;
  }
  return false;
}

/** Reads all of stdin (for `pbpaste | garmin-personal-api-mcp setup --key-stdin`). */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}
