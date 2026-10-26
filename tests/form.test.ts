import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { createElement, type ComponentType } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { sealCredentials } from "../src/crypto";

// A native bridge stand-in allows the actual command component and submit handler
// to run offline. Serialization below matches ExtensionFormModel::submit(): fields
// with storeValue=false are excluded, and outstanding errors block submission.
const apiStub = `
  import React from "react";
  const native = name => props => React.createElement(name, props);
  export const Form = Object.assign(props => React.createElement("native-form", props, props.children, props.actions), {
    PasswordField: native("native-password"), Description: native("native-description")
  });
  export const Action = Object.assign(native("native-action"), { SubmitForm: native("native-submit"), OpenInBrowser: native("native-open") });
  export const ActionPanel = props => React.createElement(React.Fragment, null, props.children);
  const Metadata = Object.assign(props => React.createElement("native-metadata", props, props.children), { Label: native("native-label") });
  const ItemDetail = Object.assign(props => React.createElement("native-detail", props, props.metadata), { Metadata });
  const Item = Object.assign(props => React.createElement("native-item", props, props.detail, props.actions), { Detail: ItemDetail });
  export const List = Object.assign(props => React.createElement("native-list", props, props.children, props.actions), { EmptyView: native("native-empty"), Item });
  export const LocalStorage = { getItem: async () => globalThis.__vaultFormSaved, setItem: async () => { throw Error("Unexpected persistence in failed-request test"); } };
  export const getPreferenceValues = () => ({ lockOnPcLock: false, region: "in", autoLock: "5" });
  export const Icon = { Lock: "lock", Key: "key", CopyClipboard: "copy" };
  export const Toast = { Style: { Success: "success", Failure: "failure" } };
  export const showToast = async () => {};
  export const openExtensionPreferences = async () => {};
  export const open = async url => { globalThis.__vaultOpened = url; };
  export const Clipboard = { readText: async () => globalThis.__vaultCopied || "", clear: async () => { globalThis.__vaultCopied = ""; }, copy: async value => { globalThis.__vaultCopied = value; } };
`;

let command: ComponentType;
async function loadCommand() {
  if (command) return command;
  const result = await build({
    entryPoints: ["src/search-vault.tsx"], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic",
    external: ["react", "react/jsx-runtime"],
    plugins: [{ name: "native-bridge-test", setup(builder) {
      builder.onResolve({ filter: /^@vicinae\/api$/ }, () => ({ path: "api", namespace: "native-test" }));
      builder.onLoad({ filter: /.*/, namespace: "native-test" }, () => ({ contents: apiStub, loader: "js" }));
    } }],
  });
  const compiled = { exports: {} as { default: ComponentType } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(__filename), compiled, compiled.exports);
  command = compiled.exports.default;
  return command;
}

const bridge = globalThis as typeof globalThis & { __vaultFormSaved?: string; __vaultOpened?: string; __vaultCopied?: string; IS_REACT_ACT_ENVIRONMENT?: boolean };
bridge.IS_REACT_ACT_ENVIRONMENT = true;

async function render(saved?: string) {
  bridge.__vaultFormSaved = saved;
  const Command = await loadCommand();
  let renderer: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(Command)); });
  return renderer!;
}

function nativeValues(renderer: ReactTestRenderer, typed: Record<string, string>) {
  const fields = renderer.root.findAllByType("native-password");
  assert.ok(fields.every(field => !field.props.error), "Native validation must not block the next submit");
  return Object.fromEntries(fields.filter(field => field.props.storeValue !== false).map(field => [field.props.id, typed[field.props.id] ?? ""]));
}

test("filled connection fields reach OAuth submission; drafts remain disabled and edits clear native errors", async () => {
  const original = globalThis.fetch;
  let renderer: ReactTestRenderer | undefined;
  const requests: URLSearchParams[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://accounts.zoho.in/oauth/v2/token");
    requests.push(new URLSearchParams(String(init?.body)));
    return new Response("{}", { status: 401 });
  };
  try {
    renderer = await render();
    assert.equal(renderer.root.findByType("native-form").props.enableDrafts, false);
    // Submit empty fields first to reproduce the user-visible validation message.
    await act(async () => { await renderer!.root.findByType("native-submit").props.onSubmit(nativeValues(renderer!, {})); });
    assert.match(renderer.root.findAllByType("native-password").find(f => f.props.id === "master")!.props.error, /Fill in all fields/);
    const typed = { clientId: "synthetic-client", clientSecret: "synthetic-client-secret", code: "synthetic-fresh-code", master: "synthetic master password" };
    await act(async () => {
      for (const field of renderer!.root.findAllByType("native-password")) field.props.onChange(typed[field.props.id as keyof typeof typed]);
    });
    const payload = nativeValues(renderer, typed);
    assert.deepEqual(Object.keys(payload).sort(), ["clientId", "clientSecret", "code", "master"].sort());
    await act(async () => { await renderer!.root.findByType("native-submit").props.onSubmit(payload); });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].get("client_id"), typed.clientId);
    assert.equal(requests[0].get("client_secret"), typed.clientSecret);
    assert.equal(requests[0].get("code"), typed.code);
    assert.equal(requests[0].get("grant_type"), "authorization_code");
    assert.ok(!requests[0].toString().includes("synthetic+master"));
    assert.match(renderer.root.findAllByType("native-password").find(f => f.props.id === "master")!.props.error, /HTTP 401/);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    globalThis.fetch = original; delete bridge.__vaultFormSaved;
  }
});

test("saved connection unlock includes the master field and decrypts locally before token refresh", async () => {
  const original = globalThis.fetch;
  let renderer: ReactTestRenderer | undefined;
  let refreshed = false;
  const master = "synthetic local password";
  globalThis.fetch = async (_url, init) => {
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("grant_type"), "refresh_token");
    assert.equal(body.get("refresh_token"), "synthetic-refresh");
    assert.ok(!String(init?.body).includes("synthetic+local+password"));
    refreshed = true;
    return new Response("{}", { status: 401 });
  };
  try {
    const saved = await sealCredentials({ clientId: "synthetic", clientSecret: "synthetic", refreshToken: "synthetic-refresh", region: "in" }, master);
    renderer = await render(saved);
    assert.equal(renderer.root.findAllByType("native-password").length, 1);
    assert.equal(renderer.root.findAllByType("native-description").length, 0);
    assert.deepEqual(renderer.root.findByType("native-submit").props.shortcut, { modifiers: [], key: "return" });
    const values = nativeValues(renderer, { master });
    await act(async () => { await renderer!.root.findByType("native-submit").props.onSubmit(values); });
    assert.ok(refreshed);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    globalThis.fetch = original; delete bridge.__vaultFormSaved;
  }
});

test("Enter opens details without copying; field rows open/copy explicitly and locking removes the preview", async () => {
  const original = globalThis.fetch; let renderer: ReactTestRenderer | undefined;
  const master = "Example master password 42";
  const row = { secretid: "123", secretname: "Synthetic login", isshared: "NO", secreturl: "https://example.com/",
    secretData: JSON.stringify({ username: "AAECAwQFBgeGx4cleKWhnIWwDdZqHDXQPw==", password: "AAECAwQFBge+4pg6YNW2gMQ//S4v0vIXsjaWqMwVSkJHQu8MhhxG" }) };
  const ok = (value: unknown, key = "Details") => new Response(JSON.stringify({ operation: { result: { status: "Success" }, [key]: value } }));
  globalThis.fetch = async url => {
    const path = String(url);
    if (path.includes("/oauth/v2/token")) return new Response(JSON.stringify({ access_token: "synthetic" }));
    if (path.includes("GET_LOGIN")) return ok({ LOGIN: "PBKDF2_AES", SALT: "fixture-salt", ITERATION: 1000, PASSPHRASE: "AAECAwQFBgeVgI0gb5GxloH/R859RzPC" }, "details");
    if (path.includes("pageNum=1")) return ok([]);
    return ok([row]);
  };
  try {
    const saved = await sealCredentials({ clientId: "synthetic", clientSecret: "synthetic", refreshToken: "synthetic", region: "in" }, master);
    renderer = await render(saved);
    await act(async () => { await renderer!.root.findByType("native-submit").props.onSubmit(nativeValues(renderer!, { master })); });
    assert.match(renderer.root.findByType("native-list").props.navigationTitle, /1 entries/);
    await act(async () => { renderer!.root.findByType("native-list").props.onSearchTextChange("HELLO@EXAMPLE.COM"); });
    assert.equal(renderer.root.findAllByType("native-item").length, 1);
    assert.match(renderer.root.findByType("native-list").props.navigationTitle, /1\/1 entries/);
    const entry = renderer.root.findByType("native-item");
    assert.equal(entry.findAllByType("native-action")[0].props.title, "View Login Details");
    await act(async () => { await entry.findAllByType("native-action")[0].props.onAction(); });
    assert.equal(bridge.__vaultCopied, undefined);
    assert.equal(renderer.root.findByType("native-list").props.isShowingDetail, true);
    assert.equal(renderer.root.findByType("native-list").props.filtering, false);
    assert.equal(renderer.root.findByType("native-list").props.searchText, "");
    const rows = renderer.root.findAllByType("native-item");
    assert.deepEqual(rows.map(row => row.props.id), ["open", "username", "password", "totp", "url", "back", "lock"]);
    assert.equal(rows[0].findAllByType("native-action")[0].props.title, "Open Website");
    await act(async () => { await rows[0].findAllByType("native-action")[0].props.onAction(); });
    assert.equal(bridge.__vaultOpened, "https://example.com/");
    const username = renderer.root.findAllByType("native-item").find(item => item.props.id === "username")!;
    await act(async () => { await username.findAllByType("native-action")[0].props.onAction(); });
    assert.equal(bridge.__vaultCopied, "hello@example.com");
    assert.ok(renderer.root.findAllByType("native-label").filter(label => label.props.title === "Password").every(label => label.props.text === "••••••••"));
    await act(async () => { renderer!.root.findAllByType("native-action").find(action => action.props.title === "Lock Vault")!.props.onAction(); });
    assert.equal(renderer.root.findAllByType("native-detail").length, 0);
    assert.equal(renderer.root.findAllByType("native-password").length, 1);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    globalThis.fetch = original; delete bridge.__vaultFormSaved; delete bridge.__vaultCopied; delete bridge.__vaultOpened;
  }
});
