export const REGIONS = {
  in: "zoho.in", us: "zoho.com", eu: "zoho.eu", au: "zoho.com.au",
  ca: "zohocloud.ca", jp: "zoho.jp", sa: "zoho.sa", cn: "zoho.cn",
} as const;
export type Region = keyof typeof REGIONS;
export function region(value: unknown): Region {
  if (typeof value !== "string" || !Object.hasOwn(REGIONS, value)) throw new Error("Choose a supported Zoho region in extension settings.");
  return value as Region;
}
export function endpoints(value: Region = "in") {
  const domain = REGIONS[region(value)];
  return { accounts: `https://accounts.${domain}`, vault: `https://vault.${domain}`, console: `https://api-console.${domain}` };
}
export const LOCK_CHOICES = [
  { title: "After 5 minutes", value: "5" }, { title: "After 10 minutes", value: "10" },
  { title: "After 15 minutes", value: "15" }, { title: "After 30 minutes", value: "30" },
  { title: "After 1 hour", value: "60" }, { title: "After 1 day (24 hours)", value: "1440" },
  { title: "No timer (until manually locked or command exits)", value: "never" },
];
export function lockDuration(value: unknown): number | null {
  if (!LOCK_CHOICES.some(x => x.value === value)) return 5 * 60_000;
  return value === "never" ? null : Number(value) * 60_000;
}
export function lockLabel(value: unknown): string {
  return LOCK_CHOICES.find(x => x.value === value)?.title ?? LOCK_CHOICES[0].title;
}
