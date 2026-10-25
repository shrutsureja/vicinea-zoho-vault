import { createHmac } from "node:crypto";

function base32(value: string): Buffer {
  const text = value.toUpperCase().replace(/\s/g, "").replace(/=+$/, "");
  if (!/^[A-Z2-7]{16,1024}$/.test(text)) throw new Error("Unsupported TOTP secret format. Open this entry in Zoho Vault.");
  const bytes: number[] = [];
  let bits = 0, buffer = 0;
  for (const ch of text) {
    buffer = (buffer << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(ch); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); buffer &= (1 << bits) - 1; }
  }
  if (buffer !== 0 || [1, 3, 6].includes(text.length % 8)) throw new Error("Invalid TOTP secret encoding.");
  return Buffer.from(bytes);
}

// Zoho encrypts the otpauth URI in its top-level `totp` field. Only TOTP is
// accepted; HOTP and unknown parameters that alter the algorithm fail closed.
export function verificationCode(uri: string, now = Date.now()): { code: string; expiresAt: number } {
  let url: URL;
  try { url = new URL(uri); } catch { throw new Error("Unsupported TOTP configuration. Open this entry in Zoho Vault."); }
  if (url.protocol !== "otpauth:" || url.hostname !== "totp" || url.username || url.password || url.hash) throw new Error("Unsupported OTP type. Only TOTP is supported.");
  const params = url.searchParams;
  for (const key of params.keys()) {
    if (!["secret", "algorithm", "digits", "period", "issuer"].includes(key) || params.getAll(key).length !== 1) throw new Error("Unsupported or duplicate TOTP parameter.");
  }
  const algorithm = (params.get("algorithm") ?? "SHA1").toUpperCase().replace("-", "");
  const digits = Number(params.get("digits") ?? 6), period = Number(params.get("period") ?? 30);
  if (!["SHA1", "SHA256", "SHA512"].includes(algorithm) || ![6, 7, 8].includes(digits) || !Number.isInteger(period) || period < 1 || period > 300 || !Number.isSafeInteger(now) || now < 0) throw new Error("Unsupported TOTP algorithm, digits, period, or device time.");
  const key = base32(params.get("secret") ?? "");
  try {
    const step = Math.floor(now / 1000 / period);
    const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
    const mac = createHmac(algorithm.toLowerCase(), key).update(counter).digest();
    const offset = mac[mac.length - 1] & 15;
    const code = ((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, "0");
    mac.fill(0);
    return { code, expiresAt: (step + 1) * period * 1000 };
  } finally { key.fill(0); }
}
