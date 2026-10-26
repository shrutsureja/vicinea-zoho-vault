import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { Credentials } from "./crypto";

// Vicinae unloads a command every time its window hides, so an in-memory unlock cannot
// survive. While the unlock timer runs, the field key and Zoho refresh credentials are kept
// in the desktop keyring (Secret Service, via secret-tool) and removed on lock, expiry or
// PC lock. Nothing is written when secret-tool is missing: the vault then locks on hide.
const SERVICE = "zoho-vault-personal";

export interface CachedSession { v: 1; key: string; credentials: Credentials; deadline: number }

export function parseCached(raw: string, now = Date.now()): CachedSession | undefined {
  try {
    const value = JSON.parse(raw) as Partial<CachedSession>;
    const c = value.credentials;
    if (value.v !== 1 || typeof value.key !== "string" || !/^[0-9a-f]{64}$/.test(value.key)) return undefined;
    if (typeof value.deadline !== "number" || !Number.isFinite(value.deadline) || value.deadline <= now) return undefined;
    if (!c || [c.clientId, c.clientSecret, c.refreshToken].some(x => typeof x !== "string" || !x)) return undefined;
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

/** Returns false (and stores nothing) when the keyring is unavailable. */
export async function storeCached(session: CachedSession, now = Date.now()): Promise<boolean> {
  try {
    await clearCached();
    const sid = randomBytes(8).toString("hex");
    await tool(["store", "--label", "Zoho Vault unlocked session", "service", SERVICE, "sid", sid], JSON.stringify(session));
    // Remove the entry when the timer ends even if Vicinae is never reopened.
    const seconds = Math.max(1, Math.ceil((session.deadline - now) / 1000));
    spawn("sh", ["-c", 'sleep "$1"; exec secret-tool clear service "$2" sid "$3"', "sh", String(seconds), SERVICE, sid], { detached: true, stdio: "ignore" }).unref();
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
