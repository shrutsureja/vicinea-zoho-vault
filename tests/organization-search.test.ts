import test from "node:test";
import assert from "node:assert/strict";
import { constants, createCipheriv, generateKeyPairSync, publicEncrypt } from "node:crypto";
import { fieldKey, organizationKey } from "../src/crypto";
import { VaultSession, loadSession, matchesEntry, parseEntry } from "../src/vault";

const master = "Example master password 42";
const metadata = { LOGIN: "PBKDF2_AES", SALT: "fixture-salt", ITERATION: 1000, PASSPHRASE: "AAECAwQFBgeVgI0gb5GxloH/R859RzPC", USER: { USERID: "owner" } };
const personal = () => fieldKey("60b4771ac1ac947f576270f9aa82575b4a33ada5dfe14376f497c0299dbbf3c4");
function encrypt(text: string, key: Buffer) {
  const iv = Buffer.from("00010203040506070000000000000000", "hex");
  const cipher = createCipheriv("aes-256-ctr", key, iv);
  return Buffer.concat([iv.subarray(0, 8), cipher.update(text), cipher.final()]).toString("base64");
}
const ok = (data: unknown, key = "Details") => new Response(JSON.stringify({ operation: { result: { status: "Success" }, [key]: data } }));

function envelope(legacy: boolean) {
  const pair = generateKeyPairSync("rsa", { modulusLength: legacy ? 1024 : 2048 });
  const orgText = "synthetic-organization-key";
  let privateText: string, sharedKey: string;
  if (legacy) {
    const jwk = pair.privateKey.export({ format: "jwk" });
    privateText = [jwk.n, jwk.e, jwk.d, jwk.p, jwk.q, jwk.dp, jwk.dq, jwk.qi].map(x => "00" + Buffer.from(x!, "base64url").toString("hex")).join(",");
    sharedKey = publicEncrypt({ key: pair.publicKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(orgText)).toString("hex");
  } else {
    privateText = pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    sharedKey = publicEncrypt({ key: pair.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(orgText)).toString("base64");
  }
  const key = personal(); const encryptedPrivate = encrypt(privateText, key); key.fill(0);
  return { privateKey: encryptedPrivate, sharedKey, org: fieldKey(orgText) };
}

test("legacy RSA and modern OAEP organization-key envelopes unlock locally", () => {
  for (const legacy of [true, false]) {
    const data = envelope(legacy), key = personal();
    const org = organizationKey(data.privateKey, data.sharedKey, key);
    assert.deepEqual(org, data.org);
    assert.throws(() => organizationKey(data.privateKey, "bad-ciphertext", key), /Could not unlock the organization key/);
    org.fill(0); data.org.fill(0); key.fill(0);
  }
});

test("organization-key entries decrypt usernames and copy passwords even when not shared to other users", async () => {
  const key = personal(), org = fieldKey("synthetic organization key");
  const row = { secretid: "123", isshared: "YES", issharedtousers: false, sharinglevel: 10, secretname: "Fallback",
    encsecretname: encrypt("Cloud Account", org), encryptedurls: [encrypt("https://example.com/secondary", org), encrypt("https://login.example.org/", org)],
    secretData: JSON.stringify({ User_Name: encrypt("alice@example.com", org), Password: encrypt("synthetic password", org) }) };
  const session = new VaultSession("synthetic", key, [parseEntry(row)], { organizationKey: org });
  const original = globalThis.fetch;
  globalThis.fetch = async () => ok([row]);
  try {
    const entry = session.entries[0];
    assert.equal(entry.name, "Cloud Account"); assert.equal(entry.username, "alice@example.com");
    for (const query of ["CLOUD", "ALICE@EXAMPLE", "login.example.org", "cloud alice", "secondary"]) assert.ok(matchesEntry(entry, query), query);
    assert.ok(!matchesEntry(entry, "synthetic password"));
    assert.equal(await session.copyValue("123", "password"), "synthetic password");
    assert.equal(await session.copyValue("123", "username"), "alice@example.com");
    assert.equal(await session.copyValue("123", "url"), "https://example.com/secondary");
    const reference = session.entries[0]; session.lock();
    assert.equal(reference.username, ""); assert.equal(reference.name, ""); assert.ok(org.every(byte => byte === 0)); assert.ok(key.every(byte => byte === 0));
  } finally { session.lock(); globalThis.fetch = original; }
});

test("unlock gets the organization key with fallback and handles missing list fields without guessing keys", async () => {
  const data = envelope(true), original = globalThis.fetch;
  const row = { SECRETID: "123", SECRETNAME: "Synthetic", ISSHARED: "YES", PASSWORDDATA: JSON.stringify({ username: encrypt("name@example.com", data.org), password: encrypt("synthetic password", data.org) }) };
  const urls: string[] = [];
  globalThis.fetch = async url => {
    const path = String(url); urls.push(path);
    if (path.includes("GET_LOGIN")) return ok(metadata, "details");
    if (path.includes("pageNum=0")) return ok([row]);
    if (path.includes("pageNum=1")) return ok([]);
    if (path.endsWith("/user/orgkey")) return new Response("{}", { status: 403 });
    if (path.includes("OPEN_VAULT")) return ok({ PRIVATEKEY: data.privateKey, SHARINGKEY: data.sharedKey }, "details");
    return ok([row]);
  };
  let session: VaultSession | undefined;
  try {
    session = await loadSession("synthetic-token", master);
    assert.ok(urls.some(url => url.includes("OPEN_VAULT")));
    assert.equal(session.entries[0].username, "name@example.com");
    assert.equal(await session.copyValue("123", "password"), "synthetic password");
    const incomplete = parseEntry({ secretid: "456", secretname: "List metadata only" });
    assert.equal(incomplete.keyType, "unknown"); assert.ok(incomplete.canRead);
    assert.ok(!incomplete.supported);
  } finally { session?.lock(); data.org.fill(0); globalThis.fetch = original; }
});

test("permission and checkout restrictions prevent local search indexing and copying", async () => {
  const key = personal();
  const row = { secretid: "123", secretname: "Restricted", isshared: "NO", sharingtype: "SHARED_TO_ME", sharinglevel: 20,
    secretdata: { username: encrypt("restricted@example.com", key), password: encrypt("private password", key) } };
  const entry = parseEntry(row); const session = new VaultSession("synthetic", key, [entry]);
  const original = globalThis.fetch; globalThis.fetch = async () => ok([row]);
  try {
    assert.equal(session.entries[0].username, ""); assert.ok(!matchesEntry(session.entries[0], "restricted@example.com"));
    await assert.rejects(session.copyValue("123", "password"), /view\/copy access/);
    assert.ok(!parseEntry({ ...row, sharinglevel: 30, accesssctrlconfigured: "true", requeststatus: 2 }).canRead);
    assert.ok(parseEntry({ ...row, sharinglevel: 30, accesssctrlconfigured: "true", requeststatus: 4 }).canRead);
  } finally { session.lock(); globalThis.fetch = original; }
});
