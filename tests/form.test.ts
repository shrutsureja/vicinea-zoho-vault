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
  export const List = Object.assign(native("native-list"), { EmptyView: native("native-empty"), Item: native("native-item") });
  export const LocalStorage = { getItem: async () => globalThis.__vaultFormSaved, setItem: async () => { throw Error("Unexpected persistence in failed-request test"); } };
  export const getPreferenceValues = () => ({ lockOnPcLock: false, region: "in", autoLock: "5" });
  export const Icon = { Lock: "lock", Key: "key", CopyClipboard: "copy" };
  export const Toast = { Style: { Success: "success", Failure: "failure" } };
  export const showToast = async () => {};
  export const openExtensionPreferences = async () => {};
  export const open = async () => {};
  export const Clipboard = { readText: async () => "", clear: async () => {}, copy: async () => {} };
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

const bridge = globalThis as typeof globalThis & { __vaultFormSaved?: string; IS_REACT_ACT_ENVIRONMENT?: boolean };
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
    const values = nativeValues(renderer, { master });
    await act(async () => { await renderer!.root.findByType("native-submit").props.onSubmit(values); });
    assert.ok(refreshed);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    globalThis.fetch = original; delete bridge.__vaultFormSaved;
  }
});
