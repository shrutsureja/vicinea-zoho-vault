import test from "node:test";
import assert from "node:assert/strict";
import { decryptField, fieldKey, openCredentials, sealCredentials, unlockKey } from "../src/crypto";
import { VaultSession, loadSession, parseEntry, safeWebUrl } from "../src/vault";

// Fixed synthetic vectors generated with WebCrypto using the algorithm in Zoho's
// published key-derivation HTML. Production uses Node's separate cipher API.
const metadata = { LOGIN: "PBKDF2_AES", SALT: "fixture-salt", ITERATION: 1000, PASSPHRASE: "AAECAwQFBgeVgI0gb5GxloH/R859RzPC" };
const masterHex = "60b4771ac1ac947f576270f9aa82575b4a33ada5dfe14376f497c0299dbbf3c4";
const ciphertext = "AAECAwQFBge+4pg6YNW2gMQ//S4v0vIXsjaWqMwVSkJHQu8MhhxG";
const row = { secretid: "123", secretname: "Synthetic test", isshared: "NO", classification: "E", secretData: JSON.stringify({ password: ciphertext }), secreturl: "https://example.com/" };
const ok = (details: unknown, key = "Details") => new Response(JSON.stringify({ operation: { result: { status: "Success" }, [key]: details } }), { status: 200 });

test("Zoho field key and multilingual decryption match independent WebCrypto vectors", async () => {
  const key = fieldKey(masterHex);
  assert.equal(key.toString("hex"), "dcdfc69e62e787966eeab35de790ce66dcdfc69e62e787966eeab35de790ce66");
  assert.equal(decryptField(ciphertext, key), "P@ssw0rd — नमस्ते");
  assert.equal(decryptField("AAECAwQFBgeGx4cleKWhnIWwDdZqHDXQPw==", key), "hello@example.com");
  assert.deepEqual(await unlockKey("Example master password 42", metadata), key);
  await assert.rejects(unlockKey("wrong master password", metadata), /could not be verified/);
  await assert.rejects(unlockKey("x", { ...metadata, LOGIN: "SHA256" }), /PBKDF2_AES/);
  await assert.rejects(unlockKey("x", { ...metadata, ITERATION: 1e12 }), /metadata/);
  assert.throws(() => decryptField("broken!", key), /format/);
  key.fill(0);
});

test("saved connection requires correct password and rejects tampering", async () => {
  const credentials = { clientId: "synthetic-client", clientSecret: "synthetic-secret", refreshToken: "synthetic-token" };
  const sealed = await sealCredentials(credentials, "local password");
  assert.ok(!sealed.includes(credentials.clientSecret));
  assert.ok(!sealed.includes(credentials.refreshToken));
  assert.deepEqual(await openCredentials(sealed, "local password"), credentials);
  await assert.rejects(openCredentials(sealed, "wrong"), /Could not unlock/);
  const changed = JSON.parse(sealed); changed.tag = Buffer.alloc(16).toString("base64");
  await assert.rejects(openCredentials(JSON.stringify(changed), "local password"), /Could not unlock/);
  assert.notEqual(sealed, await sealCredentials(credentials, "local password"));
});

test("entry parsing fails closed for shared, unknown, and non-password records", () => {
  assert.ok(parseEntry(row).supported); // Unshared enterprise-classified fields use the personal key too.
  assert.ok(!parseEntry({ ...row, isshared: "YES" }).supported);
  assert.ok(!parseEntry({ ...row, isshared: undefined }).supported);
  assert.ok(!parseEntry({ ...row, secretData: "{}" }).supported);
  assert.equal(safeWebUrl("file:///etc/passwd"), "");
  assert.equal(safeWebUrl("javascript:alert(1)"), "");
  assert.equal(safeWebUrl("https://user:pass@example.com"), "");
});

test("pagination completes only on empty page and never silently accepts repeated pages", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? ok(metadata, "details") : ok(calls === 2 ? [row] : []);
  try {
    const session = await loadSession("synthetic-token", "Example master password 42");
    assert.equal(session.entries.length, 1);
    assert.equal(calls, 3);
    session.lock();
    assert.equal(session.entries.length, 0);
    assert.ok(!session.isOpen());
    calls = 0;
    globalThis.fetch = async () => ++calls === 1 ? ok(metadata, "details") : ok([row]);
    await assert.rejects(loadSession("synthetic-token", "Example master password 42"), /repeated a page/);
  } finally { globalThis.fetch = original; }
});

test("copy rechecks permissions, checks lock after an in-flight request, and expires", async () => {
  const original = globalThis.fetch;
  const key = fieldKey(masterHex);
  const session = new VaultSession("synthetic-token", key, [parseEntry(row)]);
  try {
    globalThis.fetch = async () => ok([row]);
    assert.equal(await session.copyValue("123", "password"), "P@ssw0rd — नमस्ते");
    globalThis.fetch = async () => ok([{ ...row, isshared: "YES" }]);
    await assert.rejects(session.copyValue("123", "password"), /organization key/);
    globalThis.fetch = async () => { session.lock(); return ok([row]); };
    await assert.rejects(session.copyValue("123", "password"), /locked/);
    assert.ok(key.every(byte => byte === 0));
    const second = new VaultSession("synthetic-token", fieldKey(masterHex), []);
    const originalNow = Date.now;
    try { Date.now = () => originalNow() + 6 * 60_000; assert.ok(!second.isOpen()); }
    finally { Date.now = originalNow; second.lock(); }
  } finally { globalThis.fetch = original; session.lock(); }
});

test("OAuth errors and HTTP-200 operation failures never become successful sessions or leak response messages", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ operation: { result: { status: "Failure", message: "PRIVATE DATA" } } }));
    await assert.rejects(loadSession("synthetic-token", "x"), e => e instanceof Error && !e.message.includes("PRIVATE DATA") && e.message.includes("authorize"));
  } finally { globalThis.fetch = original; }
});
