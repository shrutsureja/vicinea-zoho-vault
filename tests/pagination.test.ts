import test from "node:test";
import assert from "node:assert/strict";
import { loadSession } from "../src/vault";

const metadata = { LOGIN: "PBKDF2_AES", SALT: "fixture-salt", ITERATION: 1000, PASSPHRASE: "AAECAwQFBgeVgI0gb5GxloH/R859RzPC" };
const master = "Example master password 42";
const ok = (details: unknown, key = "Details", total?: number | string) => new Response(JSON.stringify({ operation: { result: { status: "Success" }, [key]: details, ...(total !== undefined ? { meta: { secretcount: total } } : {}) } }));
const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ secretid: String(from + i), secretname: `Synthetic ${from + i}`, isshared: "NO", secretData: "{}" }));

test("zero-based pagination includes all 237 entries, including the first 100", async () => {
  const original = globalThis.fetch, requested: number[] = [];
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    if (parsed.searchParams.get("OPERATION_NAME") === "GET_LOGIN") return ok(metadata, "details");
    const page = Number(parsed.searchParams.get("pageNum")); requested.push(page);
    assert.equal(parsed.searchParams.get("rowPerPage"), "100");
    return ok(page < 2 ? rows(page * 100, 100) : rows(200, 37), "Details", "237");
  };
  let session: Awaited<ReturnType<typeof loadSession>> | undefined;
  try {
    session = await loadSession("synthetic", master);
    assert.deepEqual(requested, [0, 1, 2]);
    assert.equal(session.entries.length, 237);
    assert.equal(session.entries[0].id, "0");
    assert.equal(session.entries[99].id, "99");
    assert.equal(session.entries.at(-1)?.id, "236");
  } finally { session?.lock(); globalThis.fetch = original; }
});

test("without server counts the loader still starts at zero and continues past short pages", async () => {
  const original = globalThis.fetch, requested: number[] = [];
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    if (parsed.searchParams.has("OPERATION_NAME")) return ok(metadata, "details");
    const page = Number(parsed.searchParams.get("pageNum")); requested.push(page);
    return ok(page < 3 ? rows(page * 2, 2) : []);
  };
  let session: Awaited<ReturnType<typeof loadSession>> | undefined;
  try {
    session = await loadSession("synthetic", master);
    assert.equal(session.entries.length, 6); assert.deepEqual(requested, [0, 1, 2, 3]);
  } finally { session?.lock(); globalThis.fetch = original; }
});

test("an early empty page cannot silently return fewer passwords than the server count", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    if (parsed.searchParams.has("OPERATION_NAME")) return ok(metadata, "details");
    return ok(parsed.searchParams.get("pageNum") === "0" ? rows(0, 100) : [], "Details", 237);
  };
  try { await assert.rejects(loadSession("synthetic", master), /fewer entries/); }
  finally { globalThis.fetch = original; }
});

test("a changing server count asks for refresh rather than accepting a partial vault", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    if (parsed.searchParams.has("OPERATION_NAME")) return ok(metadata, "details");
    const page = Number(parsed.searchParams.get("pageNum"));
    return ok(rows(page * 100, 100), "Details", page === 0 ? 237 : 238);
  };
  try { await assert.rejects(loadSession("synthetic", master), /vault changed/); }
  finally { globalThis.fetch = original; }
});
