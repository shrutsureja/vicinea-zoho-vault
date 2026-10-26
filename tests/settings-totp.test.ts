import test from "node:test";
import assert from "node:assert/strict";
import { fieldKey } from "../src/crypto";
import { VaultSession, refresh, parseEntry } from "../src/vault";
import { LOCK_CHOICES, REGIONS, endpoints, lockDuration } from "../src/settings";
import { lockSignal, parseLockState } from "../src/screen-lock";
import { verificationCode } from "../src/totp";
import { createCipheriv } from "node:crypto";

function b32(value: string): string {
  const bytes = Buffer.from(value); let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}

test("TOTP matches all 18 RFC 6238 vectors including times beyond 2038", () => {
  const seeds = ["12345678901234567890", "12345678901234567890123456789012", "1234567890123456789012345678901234567890123456789012345678901234"];
  const algorithms = ["SHA1", "SHA256", "SHA512"];
  const vectors = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ] as const;
  for (const [seconds, ...codes] of vectors) algorithms.forEach((algorithm, i) => {
    const result = verificationCode(`otpauth://totp?secret=${b32(seeds[i])}&algorithm=${algorithm}&digits=8&period=30`, seconds * 1000);
    assert.equal(result.code, codes[i]);
    assert.ok(result.expiresAt > seconds * 1000 && result.expiresAt <= seconds * 1000 + 30_000);
  });
  assert.equal(verificationCode(`otpauth://totp/example?secret=${b32(seeds[0])}`, 59_000).code, "287082");
});

test("TOTP rejects unsupported or ambiguous configurations without exposing secrets", () => {
  const uri = "otpauth://totp?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  for (const invalid of [uri.replace("totp", "hotp"), uri + "&algorithm=MD5", uri + "&digits=9", uri + "&period=0", uri + "&secret=OTHERSECRET", uri + "&counter=1", "not a URL"]) {
    assert.throws(() => verificationCode(invalid), e => e instanceof Error && !e.message.includes("GEZDGNBV"));
  }
});

test("encrypted empty TOTP does not hide OneAuth or trigger local code parsing", async () => {
  const original = globalThis.fetch;
  const row = { secretid: "123", isshared: "NO", secretData: "{}", totp: "AAECAwQFBgc=", oneauth_id: "synthetic-link" };
  for (const totp of ["", "null", row.totp]) {
    const entry = parseEntry({ ...row, totp });
    assert.equal(entry.hasTotp, false);
    assert.equal(entry.oneAuthId, "synthetic-link");
  }
  const session = new VaultSession("synthetic", fieldKey("synthetic"), [parseEntry(row)]);
  let lookup = false;
  globalThis.fetch = async url => {
    if (String(url).includes("accounts.zoho.in/signin/v2/lookup/self")) {
      lookup = true;
      return new Response("{}", { status: 403 });
    }
    return new Response(JSON.stringify({ operation: { result: { status: "Success" }, Details: [row] } }));
  };
  try {
    await assert.rejects(session.copyTotp("123"), /OAuth client/);
    assert.equal(lookup, true);
  } finally { session.lock(); globalThis.fetch = original; }
});

test("every timer expires at its chosen duration; no timer lasts until manual lock", () => {
  const original = Date.now; let now = 1_000_000; Date.now = () => now;
  try {
    for (const choice of LOCK_CHOICES) {
      now = 1_000_000;
      const key = Buffer.alloc(32, 1), durationMs = lockDuration(choice.value);
      const session = new VaultSession("synthetic", key, [], { durationMs });
      now += durationMs === null ? 10 * 86400_000 : durationMs - 1;
      assert.ok(session.isOpen(), choice.value);
      if (durationMs !== null) { now++; assert.ok(!session.isOpen(), choice.value); }
      session.lock(); assert.ok(!session.isOpen()); assert.ok(key.every(x => x === 0));
    }
    assert.equal(lockDuration("corrupt preference"), 300_000);
  } finally { Date.now = original; }
});

test("GNOME lock-state and signal parsing are strict", () => {
  assert.equal(parseLockState("(false,)\n"), false);
  assert.equal(parseLockState("(true,)\n"), true);
  assert.throws(() => parseLockState("service unavailable"));
  assert.ok(lockSignal("/org/gnome/ScreenSaver: org.gnome.ScreenSaver.ActiveChanged (true,)"));
  assert.ok(!lockSignal("/org/gnome/ScreenSaver: org.gnome.ScreenSaver.ActiveChanged (false,)"));
  assert.ok(!lockSignal("random text true"));
});

test("region endpoint allowlist rejects arbitrary hosts and refresh uses the saved region", async () => {
  for (const [key, domain] of Object.entries(REGIONS)) assert.equal(endpoints(key as keyof typeof REGIONS).vault, `https://vault.${domain}`);
  assert.throws(() => endpoints("malicious.example" as "in"));
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://accounts.zoho.eu/oauth/v2/token");
    assert.equal(init?.redirect, "error");
    return new Response(JSON.stringify({ access_token: "synthetic-access" }));
  };
  try { assert.equal(await refresh({ clientId: "synthetic", clientSecret: "synthetic", refreshToken: "synthetic", region: "eu" }), "synthetic-access"); }
  finally { globalThis.fetch = original; }
});

test("day-long session refreshes tokens and a pending renewal cannot reopen a locked vault", async () => {
  const originalFetch = globalThis.fetch, originalNow = Date.now;
  let now = 1_000_000, renewals = 0;
  Date.now = () => now;
  const key = fieldKey("synthetic key");
  const iv = Buffer.alloc(16); const cipher = createCipheriv("aes-256-ctr", key, iv);
  const totp = Buffer.concat([iv.subarray(0, 8), cipher.update("otpauth://totp?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"), cipher.final()]).toString("base64");
  const row = { secretid: "123", isshared: "NO", secretData: "{}", totp };
  const session = new VaultSession("old-token", key, [parseEntry(row)], { durationMs: 86400_000, renewToken: async () => { renewals++; return "new-token"; } });
  globalThis.fetch = async (_url, init) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, "Zoho-oauthtoken new-token");
    return new Response(JSON.stringify({ operation: { result: { status: "Success" }, Details: [row] } }));
  };
  try {
    now += 60 * 60_000;
    const otp = await session.copyTotp("123");
    assert.match(otp.code, /^\d{6}$/); assert.equal(renewals, 1);
    assert.equal(parseEntry(row).hasTotp, true);
    let complete: (token: string) => void = () => {};
    const pending = new VaultSession("old", Buffer.alloc(32), [], { durationMs: null, renewToken: () => new Promise(resolve => { complete = resolve; }) });
    now += 60 * 60_000;
    const copying = pending.copyTotp("123"); pending.lock(); complete("renewed");
    await assert.rejects(copying, /locked/); assert.ok(!pending.isOpen());
  } finally { session.lock(); globalThis.fetch = originalFetch; Date.now = originalNow; }
});
