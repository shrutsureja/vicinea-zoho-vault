import test from "node:test";
import assert from "node:assert/strict";
import { requestOneAuthCode } from "../src/oneauth";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("explicit OneAuth request sends a push, waits for approval, and returns only the approved code", async () => {
  const original = globalThis.fetch, requests: { path: string; method?: string }[] = [];
  let polls = 0, waiting = false;
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname; requests.push({ path, method: init?.method });
    assert.equal(new URL(String(url)).hostname, "accounts.zoho.in"); assert.equal(init?.redirect, "error");
    if (path.includes("lookup")) return json({ status_code: 201, lookup: { device: [{ is_primary: true, device_id: "synthetic-device" }] } });
    if (path.endsWith("/push")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { sendpushnotify: { app_id: "synthetic-link" } });
      return json({ status_code: 201, sendpushnotify: { token: "synthetic-push-token" } });
    }
    assert.equal((init?.headers as Record<string, string>)["Z-authorization"], "Zoho-oauthtoken synthetic-push-token");
    return ++polls === 1 ? json({ status_code: 500, errors: [{ code: "D102" }] }) : json({ status_code: 200, code: "D101", verifypushnotify: [{ totp: "012345" }] });
  };
  try {
    const result = await requestOneAuthCode({ region: "in", token: "synthetic-access", oneAuthId: "synthetic-link", signal: new AbortController().signal, check() {}, onWaiting() { waiting = true; }, wait: async () => {} });
    assert.deepEqual(result, { code: "012345", source: "oneauth" }); assert.ok(waiting); assert.equal(polls, 2);
    assert.equal(requests.filter(req => req.path.endsWith("/push")).length, 1);
  } finally { globalThis.fetch = original; }
});

test("OneAuth permission rejection and denial do not copy a code or leak server details", async () => {
  const original = globalThis.fetch;
  const input = { region: "in" as const, token: "synthetic", oneAuthId: "synthetic", signal: new AbortController().signal, check() {}, wait: async () => {} };
  try {
    globalThis.fetch = async () => json({ message: "PRIVATE SERVER DATA" }, 403);
    await assert.rejects(requestOneAuthCode(input), e => e instanceof Error && e.message.includes("OAuth client") && !e.message.includes("PRIVATE"));
    let step = 0;
    globalThis.fetch = async () => ++step === 1 ? json({ status_code: 201, lookup: { device: [{ is_primary: true, device_id: "synthetic" }] } }) : step === 2 ? json({ status_code: 201, sendpushnotify: { token: "synthetic" } }) : json({ status_code: 500, errors: [{ code: "DENIED" }] });
    await assert.rejects(requestOneAuthCode(input), /declined/);
  } finally { globalThis.fetch = original; }
});

test("cancellation while waiting prevents further polling and code delivery", async () => {
  const original = globalThis.fetch, controller = new AbortController(); let requests = 0;
  globalThis.fetch = async () => ++requests === 1 ? json({ status_code: 201, lookup: { device: [{ is_primary: true, device_id: "synthetic" }] } }) : json({ status_code: 201, sendpushnotify: { token: "synthetic" } });
  try {
    await assert.rejects(requestOneAuthCode({ region: "in", token: "synthetic", oneAuthId: "synthetic", signal: controller.signal, check() {}, onWaiting() { controller.abort(); } }), /cancelled/);
    assert.equal(requests, 2);
  } finally { globalThis.fetch = original; }
});
