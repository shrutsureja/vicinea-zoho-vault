import { Action, ActionPanel, Clipboard, Form, Icon, List, LocalStorage, Toast, getPreferenceValues, openExtensionPreferences, open, showToast } from "@vicinae/api";
import { createHash } from "node:crypto";
import { useEffect, useRef, useState } from "react";
import { openCredentials, sealCredentials } from "./crypto";
import { VaultSession, loadSession, refresh, tokenRequest } from "./vault";
import { endpoints, lockDuration, lockLabel, region } from "./settings";
import { readScreenLocked, watchScreenLock } from "./screen-lock";

function preferences() {
  const p = getPreferenceValues<{ autoLock?: string; lockOnPcLock?: boolean; region?: string }>();
  return { autoLock: p.autoLock ?? "5", lockOnPcLock: p.lockOnPcLock ?? true, region: region(p.region ?? "in") };
}

const CONNECTION = "india-connection-v1";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export default function Command() {
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [session, setSession] = useState<VaultSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [reconnect, setReconnect] = useState(false);
  const [formId, setFormId] = useState(0);
  const [policyLabel, setPolicyLabel] = useState("");
  const live = useRef(true);
  const current = useRef<VaultSession | null>(null);
  const working = useRef(false);
  const clipboardHash = useRef("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyGeneration = useRef(0);
  const pcLockEnabled = useRef(false);
  const configured = preferences();
  const settingsAction = <Action title="Extension Settings" onAction={openExtensionPreferences} />;

  async function clearOwnedClipboard() {
    const expected = clipboardHash.current;
    clipboardHash.current = "";
    if (copyTimer.current) clearTimeout(copyTimer.current);
    try {
      if (expected && hash(await Clipboard.readText()) === expected) await Clipboard.clear();
    } catch { /* Runtime may be stopping; cleanup is best effort. */ }
  }

  function lock() {
    copyGeneration.current++;
    current.current?.lock(); current.current = null;
    void clearOwnedClipboard();
    if (live.current) { setSession(null); setQuery(""); setFormId(x => x + 1); }
  }

  useEffect(() => {
    live.current = true;
    LocalStorage.getItem<string>(CONNECTION).then(value => {
      if (live.current) setSaved(value ?? null);
    }).catch(() => {
      if (live.current) { setError("Could not read the local encrypted connection."); setSaved(null); }
    });
    const timer = setInterval(() => { if (current.current && !current.current.isOpen()) lock(); }, 1000);
    return () => { live.current = false; clearInterval(timer); lock(); };
  }, []);

  useEffect(() => {
    if (!session || !pcLockEnabled.current) return;
    return watchScreenLock(() => { setError("Vault locked because your PC locked."); lock(); }, () => {
      setError("PC-lock monitoring became unavailable. Vault locked; check GNOME or change this option in settings."); lock();
    });
  }, [session]);

  async function submit(values: Form.Values) {
    if (working.current) return;
    const password = String(values.master ?? "");
    const setup = !saved || reconnect;
    if (!password || (setup && [values.clientId, values.clientSecret, values.code].some(x => !String(x ?? "").trim()))) {
      setError("Fill in all fields before continuing."); return;
    }
    working.current = true; setBusy(true); setError("");
    let opened: VaultSession | undefined;
    try {
      const p = preferences();
      if (p.lockOnPcLock && await readScreenLocked()) throw new Error("Unlock your PC before unlocking the vault.");
      const options = { durationMs: lockDuration(p.autoLock) };
      let encrypted = saved;
      if (setup) {
        const clientId = String(values.clientId).trim(), clientSecret = String(values.clientSecret).trim();
        const response = await tokenRequest({ client_id: clientId, client_secret: clientSecret, code: String(values.code).trim(), grant_type: "authorization_code" }, p.region);
        if (typeof response.access_token !== "string" || typeof response.refresh_token !== "string") throw new Error("Zoho did not return the required tokens. Generate a fresh Self Client code and reconnect.");
        const credentials = { clientId, clientSecret, refreshToken: response.refresh_token, region: p.region };
        opened = await loadSession(response.access_token, password, { ...options, region: p.region, renewToken: () => refresh(credentials) });
        encrypted = await sealCredentials(credentials, password);
        await LocalStorage.setItem(CONNECTION, encrypted);
      } else {
        const credentials = await openCredentials(saved!, password);
        const token = await refresh(credentials);
        opened = await loadSession(token, password, { ...options, region: credentials.region ?? "in", renewToken: () => refresh(credentials) });
      }
      if (p.lockOnPcLock && await readScreenLocked()) throw new Error("Your PC locked during unlock. Try again after unlocking your PC.");
      if (!live.current) { opened.lock(); return; }
      current.current?.lock(); current.current = opened;
      pcLockEnabled.current = p.lockOnPcLock;
      setPolicyLabel(lockLabel(p.autoLock) + (p.lockOnPcLock ? " · PC lock" : ""));
      setSaved(encrypted ?? null); setReconnect(false); setSession(opened);
      setFormId(x => x + 1);
    } catch (err) {
      opened?.lock();
      if (live.current) setError(err instanceof Error ? err.message : "Could not unlock the vault.");
    } finally {
      working.current = false;
      if (live.current) setBusy(false);
    }
  }

  async function copy(id: string, field: "password" | "username" | "totp") {
    if (working.current) return;
    const active = current.current;
    if (!active?.isOpen()) { lock(); return; }
    const generation = ++copyGeneration.current;
    working.current = true; setBusy(true);
    try {
      if (pcLockEnabled.current) {
        try { if (await readScreenLocked()) { lock(); throw new Error("PC is locked."); } }
        catch (err) { lock(); throw err; }
      }
      const otp = field === "totp" ? await active.copyTotp(id) : undefined;
      const value = otp ? otp.code : await active.copyValue(id, field as "password" | "username");
      if (!live.current || current.current !== active || !active.isOpen() || generation !== copyGeneration.current) return;
      if (copyTimer.current) clearTimeout(copyTimer.current);
      await Clipboard.copy(value, { concealed: true });
      clipboardHash.current = hash(value);
      if (!live.current || !active.isOpen() || current.current !== active || generation !== copyGeneration.current || (otp && Date.now() >= otp.expiresAt)) {
        await clearOwnedClipboard(); return;
      }
      const clearMs = otp ? Math.max(1, Math.min(30_000, otp.expiresAt - Date.now())) : 30_000;
      copyTimer.current = setTimeout(() => { void clearOwnedClipboard(); }, clearMs);
      await showToast({ style: Toast.Style.Success, title: field === "totp" ? "Verification code copied" : field === "password" ? "Password copied" : "Username copied", message: otp ? `Valid for ${Math.ceil((otp.expiresAt - Date.now()) / 1000)} seconds. Clipboard clears by expiry while running.` : "Clears in 30 seconds while this command is running." });
    } catch (err) {
      if (live.current) await showToast({ style: Toast.Style.Failure, title: "Could not copy", message: err instanceof Error ? err.message : "Unlock and try again." });
    } finally { working.current = false; if (live.current) setBusy(false); }
  }

  if (!session) {
    const setup = !saved || reconnect;
    return <Form key={formId} navigationTitle={setup ? "Connect Zoho Vault" : "Unlock Zoho Vault"} isLoading={busy || saved === undefined} enableDrafts={false}
      actions={<ActionPanel>
        {saved !== undefined && <Action.SubmitForm title={setup ? "Connect and Unlock" : "Unlock Vault"} onSubmit={submit} />}
        {settingsAction}
        <Action title="Open API Console" onAction={() => open(endpoints(configured.region).console + "/")} />
        {saved && <Action title={reconnect ? "Cancel Reconnect" : "Reconnect Account"} onAction={() => { setReconnect(x => !x); setError(""); setFormId(x => x + 1); }} />}
      </ActionPanel>}>
      <Form.Description text={setup ? `Data center: ${endpoints(configured.region).vault}. Generate a NEW Self Client code with scopes ZohoVault.secrets.READ,ZohoVault.user.READ.` : "Enter your Zoho Vault master password to unlock."} />
      <Form.Description title="Lock settings" text={`${lockLabel(configured.autoLock)}${configured.lockOnPcLock ? "; also on PC lock (GNOME)" : ""}. Closing the command always locks. Change these in Extension Settings; they apply on your next unlock.`} />
      {setup && <>
        {/* storeValue controls submission, not disk persistence. Drafts stay disabled on Form. */}
        <Form.PasswordField id="clientId" title="Client ID" onChange={() => setError("")} />
        <Form.PasswordField id="clientSecret" title="Client Secret" onChange={() => setError("")} />
        <Form.PasswordField id="code" title="Fresh Code" onChange={() => setError("")} />
      </>}
      <Form.PasswordField id="master" title="Master Password" onChange={() => setError("")} error={error || undefined} />
      <Form.Description text="Your master password stays local. Saved connection credentials are encrypted with it. Supports PBKDF2_AES personal-key entries and stored TOTP; organization keys, linked OneAuth secrets and passkeys are not supported." />
    </Form>;
  }

  const entries = session.entries.filter(entry => `${entry.name} ${entry.url}`.toLowerCase().includes(query.toLowerCase()));
  return <List navigationTitle={`Zoho Vault · ${policyLabel}`} isLoading={busy} searchText={query} onSearchTextChange={setQuery} filtering={false} searchBarPlaceholder="Search names or websites…"
    actions={<ActionPanel><Action title="Lock Vault" icon={Icon.Lock} onAction={lock} />{settingsAction}</ActionPanel>}>
    <List.EmptyView title={query ? "No matching entries" : "No entries found"} description="Use the action panel to lock your vault." />
    {entries.map(entry => <List.Item key={entry.id} title={entry.name} subtitle={entry.url}
      icon={entry.personalKey ? "zoho-vault-icon.svg" : Icon.Lock} accessories={entry.hasTotp ? [{ text: "TOTP" }] : entry.supported ? [] : [{ text: "Open in Zoho" }]}
      actions={<ActionPanel>
        {entry.supported && <>
          <Action title="Copy Password" icon={Icon.CopyClipboard} onAction={() => copy(entry.id, "password")} />
          <Action title="Copy Username" onAction={() => copy(entry.id, "username")} shortcut={{ modifiers: ["ctrl"], key: "u" }} />
        </>}
        {entry.personalKey && <Action title="Copy Verification Code" onAction={() => copy(entry.id, "totp")} shortcut={{ modifiers: ["ctrl"], key: "t" }} />}
        {entry.url && <Action.OpenInBrowser title="Open Website" url={entry.url} />}
        <Action.OpenInBrowser title="Open Zoho Vault" url={endpoints(session.region).vault + "/"} />
        <Action title="Lock Vault" icon={Icon.Lock} onAction={lock} shortcut={{ modifiers: ["ctrl"], key: "l" }} />
        {settingsAction}
      </ActionPanel>} />)}
  </List>;
}
