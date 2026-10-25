import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const args = ["--session", "--dest", "org.gnome.ScreenSaver", "--object-path", "/org/gnome/ScreenSaver"];

export function parseLockState(output: string): boolean {
  const match = /^\s*\((true|false),?\)\s*$/.exec(output);
  if (!match) throw new Error("Desktop lock state could not be verified.");
  return match[1] === "true";
}
export async function readScreenLocked(): Promise<boolean> {
  try {
    const { stdout } = await run("gdbus", ["call", ...args, "--method", "org.gnome.ScreenSaver.GetActive"], { timeout: 3000, maxBuffer: 4096, env: { ...process.env, LC_ALL: "C" } });
    return parseLockState(stdout);
  } catch { throw new Error("PC-lock detection needs GNOME and gdbus. Turn off Lock on PC Lock in settings to use this desktop without it."); }
}

export function lockSignal(line: string): boolean {
  return /org\.gnome\.ScreenSaver\.ActiveChanged\s*\(true,?\)/.test(line);
}

export function watchScreenLock(onLock: () => void, onUnavailable: () => void): () => void {
  let stopped = false, checking = false, pending = "";
  const monitor = spawn("gdbus", ["monitor", ...args], { stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, LC_ALL: "C" } });
  const fail = () => { if (!stopped) { stop(); onUnavailable(); } };
  monitor.on("error", fail); monitor.on("exit", fail);
  monitor.stdout.on("data", (chunk: Buffer) => {
    pending += chunk.toString();
    const lines = pending.split("\n"); pending = lines.pop()!.slice(-4096);
    if (!stopped && lines.some(lockSignal)) { stop(); onLock(); }
  });
  const poll = async () => {
    if (stopped || checking) return;
    checking = true;
    try { if (await readScreenLocked() && !stopped) { stop(); onLock(); } }
    catch { fail(); }
    finally { checking = false; }
  };
  const timer = setInterval(() => { void poll(); }, 1000);
  function stop() { stopped = true; clearInterval(timer); monitor.kill(); }
  void poll();
  return stop;
}
