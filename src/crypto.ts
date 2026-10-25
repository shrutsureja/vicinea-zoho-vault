import { createCipheriv, createDecipheriv, pbkdf2, randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { Region, region } from "./settings";

const pbkdf = promisify(pbkdf2);
const localKdf = promisify(scrypt);

// Zoho's published key-derivation HTML uses the first 32 bytes of the hex key
// as an AES key, encrypts its first block, then repeats that block for AES-CTR.
export function fieldKey(masterHex: string): Buffer {
  const seed = Buffer.alloc(32);
  Buffer.from(masterHex, "utf8").copy(seed, 0, 0, 32);
  const aes = createCipheriv("aes-256-ecb", seed, null);
  aes.setAutoPadding(false);
  const block = Buffer.concat([aes.update(seed.subarray(0, 16)), aes.final()]);
  seed.fill(0);
  const key = Buffer.concat([block, block]);
  block.fill(0);
  return key;
}

// Zoho's legacy UTF-8 routine encodes UTF-16 surrogate halves separately.
// Decode both that CESU-8 representation and ordinary UTF-8 without replacement.
function decodeText(data: Buffer): string {
  let out = "";
  for (let i = 0; i < data.length;) {
    const first = data[i++];
    if (first < 128) { out += String.fromCharCode(first); continue; }
    const count = first >= 0xf0 && first <= 0xf4 ? 3 : first >= 0xe0 && first <= 0xef ? 2 : first >= 0xc2 && first <= 0xdf ? 1 : -1;
    if (count < 0 || i + count > data.length) throw new Error("Unsupported encrypted text.");
    let cp = first & (count === 3 ? 7 : count === 2 ? 15 : 31);
    for (let n = 0; n < count; n++) {
      const next = data[i++];
      if ((next & 0xc0) !== 0x80) throw new Error("Unsupported encrypted text.");
      cp = (cp << 6) | (next & 63);
    }
    if (cp < (count === 1 ? 128 : count === 2 ? 2048 : 65536) || cp > 0x10ffff) throw new Error("Unsupported encrypted text.");
    out += String.fromCodePoint(cp);
  }
  return out;
}

export function decryptField(ciphertext: string, key: Buffer): string {
  if (!ciphertext) return "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext) || ciphertext.length % 4 !== 0) throw new Error("Unsupported encrypted field format.");
  const input = Buffer.from(ciphertext, "base64");
  if (input.length < 8) throw new Error("Unsupported encrypted field format.");
  const iv = Buffer.alloc(16);
  input.copy(iv, 0, 0, 8);
  const aes = createDecipheriv("aes-256-ctr", key, iv);
  const plain = Buffer.concat([aes.update(input.subarray(8)), aes.final()]);
  try { return decodeText(plain); } finally { plain.fill(0); }
}

export async function unlockKey(password: string, metadata: Record<string, unknown>): Promise<Buffer> {
  if (metadata.LOGIN !== "PBKDF2_AES") throw new Error("This first version supports PBKDF2_AES personal vaults only.");
  const iterations = Number(metadata.ITERATION);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000 || typeof metadata.SALT !== "string" || typeof metadata.PASSPHRASE !== "string") {
    throw new Error("Unsupported vault login metadata.");
  }
  const derived = await pbkdf(password, Buffer.from(metadata.SALT, "latin1"), iterations, 32, "sha256");
  const key = fieldKey(derived.toString("hex"));
  derived.fill(0);
  try {
    const check = JSON.parse(decryptField(metadata.PASSPHRASE, key));
    if (!check || typeof check !== "object") throw new Error();
    return key;
  } catch {
    key.fill(0);
    throw new Error("Master password could not be verified. Check it and try again.");
  }
}

export interface Credentials { clientId: string; clientSecret: string; refreshToken: string; region?: Region }
interface Envelope { version: 1; salt: string; iv: string; tag: string; data: string }
const AAD = Buffer.from("vicinae-zoho-vault:credentials:v1");

export async function sealCredentials(credentials: Credentials, password: string): Promise<string> {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = await localKdf(password, salt, 32) as Buffer;
  const plain = Buffer.from(JSON.stringify(credentials));
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(AAD);
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);
    return JSON.stringify({ version: 1, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") } satisfies Envelope);
  } finally { key.fill(0); plain.fill(0); }
}

export async function openCredentials(saved: string, password: string): Promise<Credentials> {
  try {
    if (saved.length > 100_000) throw new Error();
    const e = JSON.parse(saved) as Envelope;
    if (e.version !== 1) throw new Error();
    const salt = Buffer.from(e.salt, "base64"), iv = Buffer.from(e.iv, "base64"), tag = Buffer.from(e.tag, "base64");
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error();
    const key = await localKdf(password, salt, 32) as Buffer;
    let plain: Buffer | undefined;
    try {
      const aes = createDecipheriv("aes-256-gcm", key, iv);
      aes.setAAD(AAD); aes.setAuthTag(tag);
      plain = Buffer.concat([aes.update(Buffer.from(e.data, "base64")), aes.final()]);
      const c = JSON.parse(plain.toString("utf8")) as Credentials;
      if (![c.clientId, c.clientSecret, c.refreshToken].every(x => typeof x === "string" && x.length > 0)) throw new Error();
      if (c.region !== undefined) region(c.region);
      return c;
    } finally { key.fill(0); plain?.fill(0); }
  } catch { throw new Error("Could not unlock saved connection. Check your master password, or reconnect if it changed."); }
}
