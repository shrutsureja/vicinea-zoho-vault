// Pure display helpers for the search view. Nothing here performs network requests.
import type { Entry } from "./vault";

/** Hostname without "www.", or "" for a missing/invalid URL. Never fetched: display only. */
export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/** Zoho imports de-duplicate names as "site.com_1"; show the base name and let the username tell them apart. */
export function displayName(entry: Pick<Entry, "name" | "url">): string {
  const match = /^(.+\.[a-z]{2,})_\d+$/i.exec(entry.name);
  return match ? match[1] : entry.name || hostOf(entry.url) || "Untitled login";
}

// A locally computed tint per site, so rows are scannable without loading remote favicons.
const TINTS = ["#7fc99a", "#8fb3e8", "#e8b26a", "#d98fd0", "#e88f8f", "#8fd6d6", "#c9b6f0", "#d6c98f"];
export function tintFor(key: string): string {
  let h = 0;
  for (const ch of key.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function remainingLabel(lockAt: number, now = Date.now()): string {
  if (!Number.isFinite(lockAt)) return "no lock timer";
  const minutes = Math.max(0, Math.ceil((lockAt - now) / 60_000));
  if (minutes >= 120) return `locks in ${Math.round(minutes / 60)} h`;
  return minutes <= 1 ? "locks in under a minute" : `locks in ${minutes} min`;
}
