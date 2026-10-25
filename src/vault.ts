import { Credentials, decryptField, organizationKey, unlockKey } from "./crypto";
import { Region, endpoints } from "./settings";
import { verificationCode } from "./totp";
import { requestOneAuthCode } from "./oneauth";

type Obj = Record<string, unknown>;
export function object(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unexpected Zoho response format.");
  return value as Obj;
}

async function jsonRequest(url: string, init: RequestInit): Promise<Obj> {
  try {
    const res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Zoho rejected the request (HTTP ${res.status}). Check your connection and read permissions.`);
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

export interface Entry {
  id: string; name: string; url: string; urls: string[]; username: string;
  encrypted: Record<string, string>; encryptedName: string; encryptedUrls: string[];
  supported: boolean; personalKey: boolean; keyType: "personal" | "organization" | "unknown";
  hasTotp: boolean; oneAuthId: string; canRead: boolean; reason: string;
}
export function safeWebUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href : ""; } catch { return ""; }
}
function strings(value: unknown): string[] {
  try { if (typeof value === "string") value = JSON.parse(value); } catch { return []; }
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}
function truthy(value: unknown) { return value === true || ["true", "yes"].includes(String(value).toLowerCase()); }
function encryptedField(fields: Record<string, string>, type: "password" | "username"): string {
  const names = type === "password" ? ["password", "passwd", "pwd"] : ["username", "loginname", "loginid", "email", "userid"];
  for (const name of names) {
    const found = Object.entries(fields).find(([key]) => key.toLowerCase().replace(/[\s_-]/g, "") === name);
    if (found) return found[1];
  }
  return "";
}

export function parseEntry(value: unknown, userId = ""): Entry {
  const row = object(value);
  const read = (lower: string, upper: string) => row[lower] ?? row[upper];
  const id = read("secretid", "SECRETID"), name = read("secretname", "SECRETNAME");
  if (typeof id !== "string" && typeof id !== "number") throw new Error("Unexpected password identifier.");
  const raw = row.secretData ?? row.secretdata ?? row.SECRETDATA ?? row.PASSWORDDATA ?? row.passwordData;
  let fields: Obj = {};
  try { fields = object(typeof raw === "string" ? JSON.parse(raw) : raw); } catch { /* List data can be omitted; fetch details on copy. */ }
  const encrypted = Object.fromEntries(Object.entries(fields).filter((x): x is [string, string] => typeof x[1] === "string"));
  const shared = String(read("isshared", "ISSHARED") ?? "").trim().toUpperCase();
  const keyType = ["YES", "TRUE"].includes(shared) ? "organization" : ["NO", "FALSE"].includes(shared) ? "personal" : "unknown";
  const totp = row.totp ?? row.TOTP;
  if (typeof totp === "string" && totp && totp !== "null") encrypted.totp = totp;
  const levelValue = read("sharinglevel", "SHARINGLEVEL"), level = Number(levelValue);
  const owned = !!userId && String(read("userid", "USERID")) === userId;
  const sharedToMe = String(read("sharingtype", "SHARINGTYPE")).toUpperCase() === "SHARED_TO_ME";
  const accessControlled = truthy(row.accesssctrlconfigured ?? row.accesscontrolconfigured ?? row.ACCESSCTRLCONFIGURED);
  const canRead = !(levelValue !== undefined && [20, -1].includes(level)) &&
    (!sharedToMe || owned || (levelValue !== undefined && [10, 30, 40].includes(level))) &&
    (!accessControlled || owned || Number(read("requeststatus", "REQUESTSTATUS")) === 4);
  const urls = [...new Set([...strings(row.secretmultipleurl ?? row.SECRETMULTIPLEURL ?? row.secreturls), read("secreturl", "SECRETURL")].map(safeWebUrl).filter(Boolean))];
  return { id: String(id), name: typeof name === "string" ? name : "Unnamed entry", url: urls[0] ?? "", urls, username: "",
    encrypted, encryptedName: typeof row.encsecretname === "string" ? row.encsecretname : "",
    encryptedUrls: strings(row.encryptedurls), supported: canRead && keyType === "personal" && !!encryptedField(encrypted, "password"),
    personalKey: keyType === "personal", keyType, hasTotp: !!encrypted.totp,
    oneAuthId: typeof row.oneauth_id === "string" || typeof row.oneauth_id === "number" ? String(row.oneauth_id) : "", canRead,
    reason: canRead ? "" : "Access restricted in Zoho" };
}

export function matchesEntry(entry: Entry, query: string): boolean {
  const haystack = [entry.name, entry.username, ...entry.urls].join("\n").normalize("NFKC").toLowerCase();
  return query.normalize("NFKC").trim().toLowerCase().split(/\s+/).every(term => haystack.includes(term));
}

export interface SessionOptions {
  durationMs?: number | null; region?: Region; renewToken?: () => Promise<string>;
  organizationKey?: Buffer; userId?: string; organizationKeyError?: string;
}

async function loadOrganizationKey(token: string, key: Buffer, region: Region): Promise<Buffer> {
  // Current browser-extension endpoint first, documented OPEN_VAULT as fallback.
  const paths = ["/api/rest/json/v1/user/orgkey", "/api/json/login?OPERATION_NAME=OPEN_VAULT&startIndex=0&limit=1"];
  for (const path of paths) {
    try {
      const op = await vaultGet(path, token, region);
      const details = object(op.Details ?? op.details);
      const encryptedPrivate = details.privateKey ?? details.PRIVATEKEY;
      const wrapped = details.sharedKey ?? details.SHARINGKEY;
      if (typeof encryptedPrivate === "string" && typeof wrapped === "string" && encryptedPrivate && wrapped && encryptedPrivate !== "null" && wrapped !== "null") {
        return organizationKey(encryptedPrivate, wrapped, key);
      }
    } catch { /* No remote bodies/keys are logged; try the documented fallback. */ }
  }
  throw new Error("Organization key unavailable. Check Vault sharing approval and API permissions.");
}

export class VaultSession {
  private deadline: number;
  private tokenExpires = Date.now() + 55 * 60_000;
  private renewToken?: () => Promise<string>;
  private orgKey?: Buffer;
  private userId: string;
  private orgError: string;
  readonly region: Region;
  private closed = false;
  private oneAuthRequests = new Set<AbortController>();
  constructor(private token: string, private key: Buffer, public entries: Entry[], options: SessionOptions = {}) {
    this.deadline = options.durationMs === null ? Infinity : Date.now() + (options.durationMs ?? 5 * 60_000);
    this.region = options.region ?? "in"; this.renewToken = options.renewToken;
    this.orgKey = options.organizationKey; this.userId = options.userId ?? ""; this.orgError = options.organizationKeyError ?? "Organization key unavailable";
    this.entries = entries.map(entry => this.indexEntry(entry));
  }
  isOpen() { return !this.closed && Date.now() < this.deadline; }
  lock() {
    this.closed = true; this.token = ""; this.renewToken = undefined;
    this.key.fill(0); this.orgKey?.fill(0); this.orgKey = undefined;
    for (const entry of this.entries) { entry.username = ""; entry.name = ""; entry.url = ""; entry.urls = []; }
    this.entries = [];
    this.cancelOneAuth();
  }
  private check() { if (!this.isOpen()) { this.lock(); throw new Error("Vault is locked. Unlock it again."); } }
  private entryKey(entry: Entry): Buffer | undefined {
    return entry.keyType === "personal" ? this.key : entry.keyType === "organization" ? this.orgKey : undefined;
  }
  private indexEntry(entry: Entry): Entry {
    const result = { ...entry, urls: [...entry.urls] };
    const key = this.entryKey(result);
    if (!result.canRead) return result;
    if (!key) {
      result.supported = false;
      result.reason = result.keyType === "organization" ? this.orgError : "Load details to copy";
      return result;
    }
    try {
      if (result.encryptedName) result.name = decryptField(result.encryptedName, key);
      if (result.encryptedUrls.length) result.urls = [...new Set(result.encryptedUrls.map(url => safeWebUrl(decryptField(url, key))).filter(Boolean))];
      result.url = result.urls[0] ?? "";
      const username = encryptedField(result.encrypted, "username");
      if (username) result.username = decryptField(username, key);
      result.supported = !!encryptedField(result.encrypted, "password");
      result.reason = result.supported || result.hasTotp ? "" : "Load details to copy";
    } catch { result.reason = "Some search fields could not be decrypted"; }
    return result;
  }
  private async fetchEntry(id: string, allowRestricted = false, requireKey = true): Promise<Entry> {
    this.check();
    if (!/^\d+$/.test(id)) throw new Error("Unexpected password identifier.");
    if (Date.now() >= this.tokenExpires && this.renewToken) {
      const renewed = await this.renewToken();
      this.check(); this.token = renewed; this.tokenExpires = Date.now() + 55 * 60_000;
    }
    const op = await vaultGet("/api/rest/json/v1/secrets/" + id, this.token, this.region);
    this.check();
    const details = op.Details ?? op.details;
    const entry = parseEntry(Array.isArray(details) ? details[0] : details, this.userId);
    if (entry.id !== id) throw new Error("Unexpected password identifier in Zoho's response.");
    if (!entry.canRead) {
      if (allowRestricted) return entry;
      throw new Error("Zoho does not grant view/copy access to this entry. Open Zoho Vault to request access.");
    }
    if (entry.keyType === "organization" && !this.orgKey) {
      try {
        const key = await loadOrganizationKey(this.token, this.key, this.region);
        if (!this.isOpen()) { key.fill(0); this.check(); }
        this.orgKey = key;
      } catch (err) { this.check(); if (requireKey) throw err; }
    }
    if (requireKey && !this.entryKey(entry)) throw new Error("Zoho did not identify the encryption key for this entry. Open its details in Zoho Vault.");
    const indexed = this.indexEntry(entry);
    this.entries = this.entries.map(existing => existing.id === id ? indexed : existing);
    return indexed;
  }
  async getDetails(id: string): Promise<Entry> { return this.fetchEntry(id, true, false); }
  async copyValue(id: string, field: "password" | "username" | "url"): Promise<string> {
    const entry = await this.fetchEntry(id);
    if (field === "url") {
      if (!entry.url) throw new Error("No website URL was returned for this entry.");
      return entry.url;
    }
    const data = encryptedField(entry.encrypted, field);
    if (!data) throw new Error(`No ${field} field was returned for this entry's type.`);
    return decryptField(data, this.entryKey(entry)!);
  }
  cancelOneAuth() { for (const request of this.oneAuthRequests) request.abort(); this.oneAuthRequests.clear(); }
  async copyTotp(id: string, onWaiting?: () => void): Promise<{ code: string; expiresAt?: number; source: "vault" | "oneauth" }> {
    const entry = await this.fetchEntry(id, false, false);
    if (entry.hasTotp) {
      const key = this.entryKey(entry);
      if (!key) throw new Error("The encryption key for this stored TOTP is unavailable.");
      return { ...verificationCode(decryptField(entry.encrypted.totp, key)), source: "vault" };
    }
    if (!entry.oneAuthId) throw new Error("No stored TOTP or OneAuth link was returned for this entry.");
    const controller = new AbortController(); this.oneAuthRequests.add(controller);
    try {
      const result = await requestOneAuthCode({ region: this.region, token: this.token, oneAuthId: entry.oneAuthId, signal: controller.signal, check: () => this.check(), onWaiting });
      this.check(); return result;
    } finally { this.oneAuthRequests.delete(controller); }
  }
}

export async function loadSession(token: string, password: string, options: SessionOptions = {}): Promise<VaultSession> {
  const login = await vaultGet("/api/json/login?OPERATION_NAME=GET_LOGIN", token, options.region);
  const metadata = object(login.details ?? login.Details);
  const key = await unlockKey(password, metadata);
  let orgKey: Buffer | undefined;
  try {
    const user = metadata.USER && typeof metadata.USER === "object" ? object(metadata.USER) : {};
    const userId = String(user.USERID ?? "");
    const entries = new Map<string, Entry>();
    let completed = false;
    for (let page = 1; page <= 100; page++) {
      const op = await vaultGet(`/api/rest/json/v1/secrets?isAsc=true&pageNum=${page}&rowPerPage=100`, token, options.region);
      const details = op.Details ?? op.details;
      if (!Array.isArray(details)) throw new Error("Unexpected password-list format. No partial vault was opened.");
      if (details.length === 0) { completed = true; break; }
      let added = 0;
      for (const row of details) { const entry = parseEntry(row, userId); if (!entries.has(entry.id)) { entries.set(entry.id, entry); added++; } }
      if (added === 0) throw new Error("Zoho repeated a page. No partial vault was opened.");
    }
    if (!completed) throw new Error("Vault exceeds this version's pagination limit. No partial vault was opened.");
    let organizationKeyError = "";
    if ([...entries.values()].some(entry => entry.keyType === "organization" && entry.canRead)) {
      try { orgKey = await loadOrganizationKey(token, key, options.region ?? "in"); }
      catch { organizationKeyError = "Organization key unavailable"; }
    }
    return new VaultSession(token, key, [...entries.values()], { ...options, organizationKey: orgKey, userId, organizationKeyError });
  } catch (error) { key.fill(0); orgKey?.fill(0); throw error; }
}

export async function refresh(credentials: Credentials): Promise<string> {
  const result = await tokenRequest({ client_id: credentials.clientId, client_secret: credentials.clientSecret, refresh_token: credentials.refreshToken, grant_type: "refresh_token" }, credentials.region ?? "in");
  if (typeof result.access_token !== "string" || !result.access_token) throw new Error("Zoho did not return an access token. Reconnect your account.");
  return result.access_token;
}
