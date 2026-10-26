import { Action, ActionPanel, Clipboard, Color, Form, Icon, List, LocalStorage, Toast, getPreferenceValues, openExtensionPreferences, open, showToast } from "@vicinae/api";
import { createHash } from "node:crypto";
import { useEffect, useRef, useState } from "react";
import { Credentials, openCredentials, sealCredentials } from "./crypto";
import { clearCached, loadCached, storeCached } from "./keyring";
import { Entry, VaultSession, loadSession, matchesEntry, refresh, tokenRequest } from "./vault";
import { REGIONS, endpoints, lockDuration, lockLabel, region } from "./settings";
import { readScreenLocked, watchScreenLock } from "./screen-lock";
import { version } from "../package.json";
import { displayName, hostOf, remainingLabel, tintFor } from "./display";

function preferences() {
  const p = getPreferenceValues<{ autoLock?: string; lockOnPcLock?: boolean; region?: string; keepUnlocked?: boolean }>();
  return { autoLock: p.autoLock ?? "5", lockOnPcLock: p.lockOnPcLock ?? true, keepUnlocked: p.keepUnlocked ?? true, region: region(p.region ?? "in") };
}

const CONNECTION = "india-connection-v1";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

type CopyField = "password" | "username" | "totp" | "url";

function twoFactorLabel(entry: Entry, waiting: boolean, oneAuthBlocked: boolean): string {
  if (waiting) return "Approve the request in OneAuth…";
  if (entry.hasTotp) return "Vault TOTP · Ctrl+T to copy";
  if (entry.oneAuthId && oneAuthBlocked) return "OneAuth · not allowed for this token; use the Zoho Vault browser extension";
  if (entry.oneAuthId) return "OneAuth · Ctrl+T sends a push";
  return "Not stored in this entry";
}

export default function Command() {
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [session, setSession] = useState<VaultSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [showDetail, setShowDetail] = useState(true);
  const [waitingFor, setWaitingFor] = useState("");
  const [reconnect, setReconnect] = useState(false);
  const [formId, setFormId] = useState(0);
  const [oneAuthBlocked, setOneAuthBlocked] = useState(false);
  const [remaining, setRemaining] = useState("");
  const live = useRef(true);
  const current = useRef<VaultSession | null>(null);
  const working = useRef(false);
  const clipboardHash = useRef("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyGeneration = useRef(0);
  const pcLockEnabled = useRef(false);
  const configured = preferences();
  const settingsAction = <Action title="Extension Settings" icon={Icon.Cog} onAction={openExtensionPreferences} />;

  async function clearOwnedClipboard() {
    const expected = clipboardHash.current;
    clipboardHash.current = "";
    if (copyTimer.current) clearTimeout(copyTimer.current);
    try {
      if (expected && hash(await Clipboard.readText()) === expected) await Clipboard.clear();
    } catch { /* Runtime may be stopping; cleanup is best effort. */ }
  }

  // Unmount only wipes memory (keepCache); every real lock also drops the keyring copy.
  function lock(keepCache = false) {
    if (!keepCache) void clearCached();
    copyGeneration.current++;
    current.current?.lock(); current.current = null;
    void clearOwnedClipboard();
    if (live.current) { setSession(null); setWaitingFor(""); setQuery(""); setFormId(x => x + 1); }
  }

  // Vicinae reloads the command after every window hide; rebuild the session from the keyring cache.
  async function restore() {
    const p = preferences();
    if (!p.keepUnlocked) { await clearCached(); return; }
    const cached = await loadCached();
    if (!cached || !live.current) return;
    setBusy(true);
    let opened: VaultSession | undefined;
    try {
      if (p.lockOnPcLock && await readScreenLocked()) throw new Error("PC locked");
      const credentials = cached.credentials;
      const token = await refresh(credentials);
      opened = await loadSession(token, Buffer.from(cached.key, "hex"), { durationMs: cached.deadline - Date.now(), region: credentials.region ?? "in", renewToken: () => refresh(credentials) });
      if (p.lockOnPcLock && await readScreenLocked()) throw new Error("PC locked");
      if (!live.current) { opened.lock(); return; }
      current.current?.lock(); current.current = opened;
      pcLockEnabled.current = p.lockOnPcLock;
      setRemaining(remainingLabel(opened.lockAt()));
      setSession(opened); setFormId(x => x + 1);
    } catch {
      opened?.lock();
      await clearCached();
    } finally { if (live.current) setBusy(false); }
  }

  useEffect(() => {
    live.current = true;
    LocalStorage.getItem<string>(CONNECTION).then(value => {
      if (live.current) setSaved(value ?? null);
      if (value) return restore();
    }).catch(() => {
      if (live.current) { setError("Could not read the local encrypted connection."); setSaved(null); }
    });
    const timer = setInterval(() => {
      const active = current.current;
      if (!active) return;
      if (!active.isOpen()) { lock(); return; }
      const label = remainingLabel(active.lockAt());
      setRemaining(previous => previous === label ? previous : label);
    }, 1000);
    return () => { live.current = false; clearInterval(timer); lock(true); };
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
      let credentials: Credentials;
      if (setup) {
        const clientId = String(values.clientId).trim(), clientSecret = String(values.clientSecret).trim();
        const response = await tokenRequest({ client_id: clientId, client_secret: clientSecret, code: String(values.code).trim(), grant_type: "authorization_code" }, p.region);
        if (typeof response.access_token !== "string" || typeof response.refresh_token !== "string") throw new Error("Zoho did not return the required tokens. Generate a fresh Self Client code and reconnect.");
        credentials = { clientId, clientSecret, refreshToken: response.refresh_token, region: p.region };
        opened = await loadSession(response.access_token, password, { ...options, region: p.region, renewToken: () => refresh(credentials) });
        encrypted = await sealCredentials(credentials, password);
        await LocalStorage.setItem(CONNECTION, encrypted);
      } else {
        credentials = await openCredentials(saved!, password);
        const credentialsNow = credentials;
        const token = await refresh(credentials);
        opened = await loadSession(token, password, { ...options, region: credentials.region ?? "in", renewToken: () => refresh(credentialsNow) });
      }
      if (p.lockOnPcLock && await readScreenLocked()) throw new Error("Your PC locked during unlock. Try again after unlocking your PC.");
      if (!live.current) { opened.lock(); return; }
      current.current?.lock(); current.current = opened;
      pcLockEnabled.current = p.lockOnPcLock;
      if (p.keepUnlocked && Number.isFinite(opened.lockAt())) void storeCached({ v: 1, key: opened.snapshotKey(), credentials, deadline: opened.lockAt() });
      else void clearCached();
      setRemaining(remainingLabel(opened.lockAt()));
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

  async function copy(id: string, field: CopyField) {
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
      if (field === "totp" && oneAuthBlocked && !session?.entries.find(e => e.id === id)?.hasTotp) throw new Error("OneAuth is not allowed for this token. Use the Zoho Vault browser extension for this code.");
      const otp = field === "totp" ? await active.copyTotp(id, () => { if (live.current) setWaitingFor(id); }) : undefined;
      const value = otp ? otp.code : await active.copyValue(id, field as "password" | "username" | "url");
      if (!live.current || current.current !== active || !active.isOpen() || generation !== copyGeneration.current) return;
      if (copyTimer.current) clearTimeout(copyTimer.current);
      await Clipboard.copy(value, { concealed: true });
      clipboardHash.current = hash(value);
      if (!live.current || !active.isOpen() || current.current !== active || generation !== copyGeneration.current || (otp?.expiresAt !== undefined && Date.now() >= otp.expiresAt)) {
        await clearOwnedClipboard(); return;
      }
      const clearMs = otp?.expiresAt !== undefined ? Math.max(1, Math.min(30_000, otp.expiresAt - Date.now())) : 30_000;
      copyTimer.current = setTimeout(() => { void clearOwnedClipboard(); }, clearMs);
      const title = field === "totp" ? "Verification code copied" : field === "password" ? "Password copied" : field === "url" ? "URL copied" : "Username copied";
      const message = otp?.source === "oneauth" ? "OneAuth approved. Use this code now."
        : `Clipboard clears in ${Math.ceil(clearMs / 1000)}s while this command is open.`;
      await showToast({ style: Toast.Style.Success, title, message });
    } catch (err) {
      if (live.current && field === "totp" && err instanceof Error && /not available to this OAuth client/.test(err.message)) setOneAuthBlocked(true);
      if (live.current) await showToast({ style: Toast.Style.Failure, title: "Could not copy", message: err instanceof Error ? err.message : "Unlock and try again." });
    } finally { working.current = false; if (live.current) { setBusy(false); setWaitingFor(""); } }
  }

  if (!session) {
    const setup = !saved || reconnect;
    const p = preferences();
    // The returning unlock form stays description-free; its context lives in the footer.
    const context = `${REGIONS[configured.region]} · auto-lock ${lockLabel(p.autoLock).toLowerCase()}${p.lockOnPcLock ? " or on PC lock" : ""}`;
    return <Form key={formId} navigationTitle={setup ? `Connect Zoho Vault · v${version}` : `Unlock Zoho Vault · ${context}`} isLoading={busy || saved === undefined} enableDrafts={false}
      actions={<ActionPanel>
        {saved !== undefined && <Action.SubmitForm title={setup ? "Connect and Unlock" : "Unlock Vault"} icon={Icon.LockUnlocked} shortcut={{ modifiers: [], key: "return" }} onSubmit={submit} />}
        <ActionPanel.Section>
          {saved && <Action title={reconnect ? "Cancel Reconnect" : "Reconnect Account"} onAction={() => { setReconnect(x => !x); setError(""); setFormId(x => x + 1); }} />}
          <Action title="Open API Console" icon={Icon.Globe01} onAction={() => open(endpoints(configured.region).console + "/")} />
          {settingsAction}
        </ActionPanel.Section>
      </ActionPanel>}>
      {setup && <Form.Description text={`Connect your ${endpoints(configured.region).vault} account with a fresh Self Client code. Scopes: ZohoVault.secrets.READ,ZohoVault.user.READ.`} />}
      {setup && <>
        {/* storeValue controls submission, not disk persistence. Drafts stay disabled on Form. */}
        <Form.PasswordField id="clientId" title="Client ID" onChange={() => setError("")} />
        <Form.PasswordField id="clientSecret" title="Client Secret" onChange={() => setError("")} />
        <Form.PasswordField id="code" title="Fresh Code" onChange={() => setError("")} />
      </>}
      <Form.PasswordField id="master" title="Master Password" autoFocus={!setup} onChange={() => setError("")} error={error || undefined} />
    </Form>;
  }

  const vaultUrl = endpoints(session.region).vault + "/";
  const toggleDetail = <Action title={showDetail ? "Hide Details" : "Show Details"} icon={Icon.AppWindowSidebarRight} onAction={() => setShowDetail(x => !x)} shortcut={{ modifiers: ["ctrl"], key: "d" }} />;
  const lockAction = <Action title="Lock Vault" icon={Icon.Lock} style={Action.Style.Destructive} onAction={() => lock()} shortcut={{ modifiers: ["ctrl"], key: "l" }} />;

  function entryActions(entry: Entry) {
    const twoFactor = entry.canRead && (entry.hasTotp || entry.oneAuthId)
      ? <Action title={entry.hasTotp ? "Copy Verification Code" : "Request OneAuth Code"} icon={Icon.Key} onAction={() => copy(entry.id, "totp")} shortcut={{ modifiers: ["ctrl"], key: "t" }} />
      : null;
    const openSite = entry.url ? <Action title="Open Website" icon={Icon.Globe01} onAction={() => open(entry.url)} shortcut={{ modifiers: ["ctrl"], key: "o" }} /> : null;
    return <ActionPanel title={displayName(entry)}>
      {entry.canRead ? <ActionPanel.Section title="Copy">
        {/* First action runs on Enter, the second on Shift+Enter; Ctrl+P / Ctrl+U kept for existing users. */}
        <Action title="Copy Password" icon={Icon.CopyClipboard} onAction={() => copy(entry.id, "password")} shortcut={{ modifiers: ["ctrl"], key: "p" }} />
        <Action title="Copy Username" icon={Icon.Person} onAction={() => copy(entry.id, "username")} shortcut={{ modifiers: ["ctrl"], key: "u" }} />
        {twoFactor}
        {entry.url && <Action title="Copy URL" icon={Icon.Link} onAction={() => copy(entry.id, "url")} shortcut={{ modifiers: ["ctrl"], key: "y" }} />}
      </ActionPanel.Section> : null}
      <ActionPanel.Section title="Open">
        {openSite}
        <Action.OpenInBrowser title="Open in Zoho Vault" url={vaultUrl} shortcut={{ modifiers: ["ctrl", "shift"], key: "o" }} />
      </ActionPanel.Section>
      <ActionPanel.Section title="Vault">
        {waitingFor === entry.id && <Action title="Cancel OneAuth Request" icon={Icon.XMarkCircle} onAction={() => current.current?.cancelOneAuth()} shortcut={{ modifiers: ["ctrl"], key: "x" }} />}
        {toggleDetail}
        {lockAction}
        {settingsAction}
      </ActionPanel.Section>
    </ActionPanel>;
  }

  function entryDetail(entry: Entry) {
    const host = hostOf(entry.url);
    return <List.Item.Detail metadata={<List.Item.Detail.Metadata>
      <List.Item.Detail.Metadata.Label title={displayName(entry)} text={host} icon={{ source: Icon.Key, tintColor: tintFor(host || entry.name) }} />
      <List.Item.Detail.Metadata.Separator />
      {entry.username && <List.Item.Detail.Metadata.Label title="Username" text={entry.username} />}
      {entry.canRead && <List.Item.Detail.Metadata.Label title="Password" text="••••••••" />}
      <List.Item.Detail.Metadata.Label title="Verification code" text={twoFactorLabel(entry, waitingFor === entry.id, oneAuthBlocked)} />
      {entry.url && <List.Item.Detail.Metadata.Label title="Website" text={entry.url} />}
      <List.Item.Detail.Metadata.Separator />
      <List.Item.Detail.Metadata.Label title="Vault" text={entry.keyType === "organization" ? "Organization key" : entry.keyType === "personal" ? "Personal" : "Unknown key"} />
      {entry.reason && <List.Item.Detail.Metadata.Label title="Status" text={entry.reason} />}
    </List.Item.Detail.Metadata>} />;
  }

  function accessories(entry: Entry): List.Item.Accessory[] {
    if (waitingFor === entry.id) return [{ tag: { value: "Waiting for phone", color: Color.Orange } }];
    if (entry.reason) return [{ icon: Icon.Lock, tooltip: entry.reason }];
    if (showDetail) return [];
    if (entry.hasTotp) return [{ tag: { value: "2FA", color: Color.Green } }];
    if (entry.oneAuthId) return [{ tag: { value: "OneAuth", color: Color.Orange } }];
    return [];
  }

  const entries = session.entries.filter(entry => matchesEntry(entry, query));
  const count = query.trim() ? `${entries.length}/${session.entries.length}` : String(session.entries.length);
  const showLock = !query.trim() || "lock vault".includes(query.trim().toLowerCase());
  return <List navigationTitle={`Zoho Vault · ${count} entries · ${remaining}`} isLoading={busy} isShowingDetail={showDetail && entries.length > 0}
    searchText={query} onSearchTextChange={setQuery} filtering={false} searchBarPlaceholder="Search logins by name, website or username…"
    actions={<ActionPanel>{lockAction}{settingsAction}</ActionPanel>}>
    <List.EmptyView icon={Icon.MagnifyingGlass} title={query ? "No matching logins" : "No logins in this vault"} description={query ? "Try part of the website or username. Ctrl+L locks the vault." : "Add logins in Zoho Vault, then unlock again."} />
    <List.Section title="Logins" subtitle={count}>
      {entries.map(entry => {
        const host = hostOf(entry.url);
        return <List.Item key={entry.id} id={entry.id} title={displayName(entry)}
          subtitle={showDetail ? entry.username : [entry.username, host].filter(Boolean).join(" · ")}
          icon={entry.canRead ? { source: Icon.Key, tintColor: tintFor(host || entry.name) } : Icon.Lock}
          accessories={accessories(entry)} detail={entryDetail(entry)} actions={entryActions(entry)} />;
      })}
    </List.Section>
    {showLock && <List.Section title="Vault">
      <List.Item id="lock-vault" title="Lock Vault" subtitle={remaining} icon={Icon.Lock}
        detail={<List.Item.Detail markdown={"Locks now and clears any copied secret this command still owns."} />}
        actions={<ActionPanel>{lockAction}{settingsAction}</ActionPanel>} />
    </List.Section>}
  </List>;
}
