import test from "node:test";
import assert from "node:assert/strict";
import { displayName, hostOf, remainingLabel, tintFor } from "../src/display";

test("hostOf shows a bare hostname and tolerates bad input", () => {
  assert.equal(hostOf("https://www.example.com/login?next=%2F"), "example.com");
  assert.equal(hostOf("http://172.24.3.43:15672/"), "172.24.3.43");
  assert.equal(hostOf(""), "");
  assert.equal(hostOf("not a url"), "");
});

test("displayName drops Zoho de-duplication suffixes only on domain-like names", () => {
  assert.equal(displayName({ name: "account.mongodb.com_1", url: "" }), "account.mongodb.com");
  assert.equal(displayName({ name: "build_2", url: "" }), "build_2");
  assert.equal(displayName({ name: "", url: "https://example.org/" }), "example.org");
  assert.equal(displayName({ name: "", url: "" }), "Untitled login");
});

test("tintFor is stable and case-insensitive", () => {
  assert.equal(tintFor("Example.com"), tintFor("example.com"));
  assert.match(tintFor("x"), /^#[0-9a-f]{6}$/);
});

test("remainingLabel rounds up to whole minutes", () => {
  const now = 1_000_000;
  assert.equal(remainingLabel(Infinity, now), "no lock timer");
  assert.equal(remainingLabel(now + 30_000, now), "locks in under a minute");
  assert.equal(remainingLabel(now + 51.2 * 60_000, now), "locks in 52 min");
  assert.equal(remainingLabel(now + 24 * 3_600_000, now), "locks in 24 h");
});
