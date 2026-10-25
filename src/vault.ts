import { Credentials, decryptField, unlockKey } from "./crypto";
import { Region, endpoints } from "./settings";
import { verificationCode } from "./totp";

type Obj = Record<string, unknown>;
export function object(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unexpected Zoho response format.");
  return value as Obj;
}

async function jsonRequest(url: string, init: RequestInit): Promise<Obj> {
  try {
    const res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Zoho rejected the request (HTTP ${res.status}). Check your connection and read permissions.`);
    // Do not forward raw API errors, bodies, URLs or tokens to UI/logging.
    const body = object(await res.json());
    if (body.error) throw new Error("Zoho authorization failed. Reconnect with a fresh code or check the client credentials.");
    return body;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Zoho ")) throw error;
    throw new Error("Could not reach Zoho or read its response. Check your network and try again.");
  }
}

export async function tokenRequest(values: Record<string, string>, region: Region = "in"): Promise<Obj> {
  return jsonRequest(endpoints(region).accounts + "/oauth/v2/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values),
  });
}

async function vaultGet(path: string, token: string, region: Region = "in"): Promise<Obj> {
  const body = await jsonRequest(endpoints(region).vault + path, { headers: { Authorization: "Zoho-oauthtoken " + token } });
  const op = object(body.operation), result = object(op.result);
  if (String(result.status).toLowerCase() !== "success") throw new Error("Zoho did not authorize this vault operation. Check the scopes and account permissions.");
  return op;
}

export interface Entry { id: string; name: string; url: string; encrypted: Record<string, string>; supported: boolean; personalKey: boolean; hasTotp: boolean }
export function safeWebUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href : ""; } catch { return ""; }
}

export function parseEntry(value: unknown): Entry {
  const row = object(value);
  const read = (lower: string, upper: string) => row[lower] ?? row[upper];
  const id = read("secretid", "SECRETID"), name = read("secretname", "SECRETNAME");
  if (typeof id !== "string" && typeof id !== "number") throw new Error("Unexpected password identifier.");
  const raw = row.secretData ?? row.SECRETDATA ?? row.PASSWORDDATA;
  let encrypted: Obj = {};
  try { encrypted = object(typeof raw === "string" ? JSON.parse(raw) : raw); } catch { /* Unsupported record remains visible. */ }
  const shared = String(read("isshared", "ISSHARED") ?? "").toUpperCase();
  // Ambiguous key ownership is never guessed; org/shared records need a separate key.
  const supported = ["NO", "FALSE"].includes(shared) && typeof encrypted.password === "string";
  const totp = row.totp ?? row.TOTP;
  if (typeof totp === "string" && totp && totp !== "null") encrypted.totp = totp;
  return { id: String(id), name: typeof name === "string" ? name : "Unnamed entry", url: safeWebUrl(read("secreturl", "SECRETURL")),
    encrypted: Object.fromEntries(Object.entries(encrypted).filter((x): x is [string, string] => typeof x[1] === "string")), supported,
    personalKey: ["NO", "FALSE"].includes(shared), hasTotp: typeof encrypted.totp === "string" && !!encrypted.totp };
}

export interface SessionOptions { durationMs?: number | null; region?: Region; renewToken?: () => Promise<string> }
export class VaultSession {
  private deadline: number;
  private tokenExpires = Date.now() + 55 * 60_000;
  private renewToken?: () => Promise<string>;
  readonly region: Region;
  private closed = false;
  constructor(private token: string, private key: Buffer, public entries: Entry[], options: SessionOptions = {}) {
    this.deadline = options.durationMs === null ? Infinity : Date.now() + (options.durationMs ?? 5 * 60_000);
    this.region = options.region ?? "in"; this.renewToken = options.renewToken;
  }
  isOpen() { return !this.closed && Date.now() < this.deadline; }
  lock() { this.closed = true; this.token = ""; this.renewToken = undefined; this.key.fill(0); this.entries = []; }
  private check() { if (!this.isOpen()) { this.lock(); throw new Error("Vault is locked. Unlock it again."); } }
  private async fetchEntry(id: string): Promise<Entry> {
    this.check();
    if (!/^\d+$/.test(id)) throw new Error("Unexpected password identifier.");
    if (Date.now() >= this.tokenExpires && this.renewToken) {
      const renewed = await this.renewToken();
      this.check(); this.token = renewed; this.tokenExpires = Date.now() + 55 * 60_000;
    }
    // Re-fetch the selected entry so server-side permission changes are respected.
    const op = await vaultGet("/api/rest/json/v1/secrets/" + id, this.token, this.region);
    this.check();
    const details = op.Details ?? op.details;
    const entry = parseEntry(Array.isArray(details) ? details[0] : details);
    if (entry.id !== id || !entry.personalKey) throw new Error("This entry needs an organization key or uses an unsupported type. Open it in Zoho Vault.");
    return entry;
  }
  async copyValue(id: string, field: "password" | "username"): Promise<string> {
    const entry = await this.fetchEntry(id);
    const data = entry.encrypted[field];
    if (!data) throw new Error(`No ${field} field is available for this entry.`);
    return decryptField(data, this.key);
  }
  async copyTotp(id: string) {
    const entry = await this.fetchEntry(id);
    if (!entry.hasTotp) throw new Error("No TOTP secret was returned for this entry. Linked Zoho OneAuth secrets are not supported.");
    return verificationCode(decryptField(entry.encrypted.totp, this.key));
  }
}

export async function loadSession(token: string, password: string, options: SessionOptions = {}): Promise<VaultSession> {
  const login = await vaultGet("/api/json/login?OPERATION_NAME=GET_LOGIN", token, options.region);
  const key = await unlockKey(password, object(login.details ?? login.Details));
  try {
    const entries = new Map<string, Entry>();
    let completed = false;
    for (let page = 1; page <= 100; page++) {
      const op = await vaultGet(`/api/rest/json/v1/secrets?isAsc=true&pageNum=${page}&rowPerPage=100`, token, options.region);
      const details = op.Details ?? op.details;
      if (!Array.isArray(details)) throw new Error("Unexpected password-list format. No partial vault was opened.");
      if (details.length === 0) { completed = true; break; }
      let added = 0;
      for (const row of details) { const entry = parseEntry(row); if (!entries.has(entry.id)) { entries.set(entry.id, entry); added++; } }
      if (added === 0) throw new Error("Zoho repeated a page. No partial vault was opened.");
    }
    if (!completed) throw new Error("Vault exceeds this version's pagination limit. No partial vault was opened.");
    return new VaultSession(token, key, [...entries.values()], options);
  } catch (error) { key.fill(0); throw error; }
}

export async function refresh(credentials: Credentials): Promise<string> {
  const result = await tokenRequest({ client_id: credentials.clientId, client_secret: credentials.clientSecret, refresh_token: credentials.refreshToken, grant_type: "refresh_token" }, credentials.region ?? "in");
  if (typeof result.access_token !== "string" || !result.access_token) throw new Error("Zoho did not return an access token. Reconnect your account.");
  return result.access_token;
}
