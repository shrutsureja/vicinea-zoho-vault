import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { Region } from "./settings";

// Vicinae unloads a command every time its window hides, so an in-memory unlock cannot
// survive. While the unlock timer runs, the field key and the short-lived Zoho access token
// are kept in the desktop keyring (Secret Service, via secret-tool). The client secret and
// refresh token never enter it. The entry is removed on lock, expiry, PC lock (also while
// Vicinae is hidden) and after at most CACHE_MAX_MS. Nothing is written if secret-tool is
// missing: the vault then locks on hide.
const SERVICE = "zoho-vault-personal";
export const CACHE_MAX_MS = 15 * 60_000;

export interface CachedSession { v: 2; key: string; token: string; region: Region; deadline: number }

export function parseCached(raw: string, now = Date.now()): CachedSession | undefined {
  try {
    const value = JSON.parse(raw) as Partial<CachedSession>;
    if (value.v !== 2 || typeof value.token !== "string" || !value.token || typeof value.region !== "string" || typeof value.key !== "string" || !/^[0-9a-f]{64}$/.test(value.key)) return undefined;
    if (typeof value.deadline !== "number" || !Number.isFinite(value.deadline) || value.deadline <= now || value.deadline > now + CACHE_MAX_MS) return undefined;
    return value as CachedSession;
  } catch { return undefined; }
}

function tool(args: string[], input = ""): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("secret-tool", args, { stdio: ["pipe", "pipe", "ignore"], timeout: 5000 });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => { if (out.length < 8192) out += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(out) : reject(new Error("secret-tool failed")));
    child.stdin.on("error", () => { /* surfaced through close */ });
    child.stdin.end(input);
  });
}

export async function clearCached(): Promise<void> {
  try { await tool(["clear", "service", SERVICE]); } catch { /* absent or no keyring */ }
}

// Background cleanup that outlives Vicinae: waits for the deadline and, when PC-lock
// watching is on, also deletes the entry the moment GNOME locks the screen. If gdbus is
// unavailable the monitor ends at once and the entry is removed (fail closed).
const CLEANUP = `if [ "$4" = 1 ]; then
  timeout "$1" gdbus monitor --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver 2>/dev/null |
  while read -r line; do case "$line" in *ActiveChanged*true*) break;; esac; done
else sleep "$1"; fi
exec secret-tool clear service "$2" sid "$3"`;

/** Stores the session (deadline capped at CACHE_MAX_MS). Returns false when the keyring is unavailable. */
export async function storeCached(session: Omit<CachedSession, "v" | "deadline"> & { deadline: number }, options: { watchLock: boolean }, now = Date.now()): Promise<boolean> {
  try {
    await clearCached();
    const deadline = Math.min(session.deadline, now + CACHE_MAX_MS);
    const sid = randomBytes(8).toString("hex");
    await tool(["store", "--label", "Zoho Vault unlocked session", "service", SERVICE, "sid", sid], JSON.stringify({ ...session, v: 2, deadline }));
    const seconds = Math.max(1, Math.ceil((deadline - now) / 1000));
    spawn("sh", ["-c", CLEANUP, "sh", String(seconds), SERVICE, sid, options.watchLock ? "1" : "0"], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch { return false; }
}

export async function loadCached(now = Date.now()): Promise<CachedSession | undefined> {
  try {
    const parsed = parseCached(await tool(["lookup", "service", SERVICE]), now);
    if (!parsed) await clearCached();
    return parsed;
  } catch { return undefined; }
}
