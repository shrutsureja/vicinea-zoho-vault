import { endpoints, Region } from "./settings";

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(new Error("OneAuth request cancelled.")); return; }
  const abort = () => { clearTimeout(timer); reject(new Error("OneAuth request cancelled.")); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
  signal.addEventListener("abort", abort, { once: true });
});

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unexpected OneAuth response.");
  return value as Record<string, any>;
}

// This flow is present in Zoho's official browser extension, but is not part of
// the public Vault API contract. The caller's OAuth scopes must authorize it.
// Never use Zoho's client credentials, browser cookies, or a fabricated app token.
export async function requestOneAuthCode(input: {
  region: Region; token: string; oneAuthId: string; signal: AbortSignal;
  check: () => void; onWaiting?: () => void; wait?: typeof wait;
}): Promise<{ code: string; source: "oneauth" }> {
  const { region, token, oneAuthId, signal, check } = input;
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(oneAuthId)) throw new Error("Invalid OneAuth link for this entry.");
  const timeout = AbortSignal.timeout(75_000);
  const requestSignal = AbortSignal.any([signal, timeout]);
  const delay = input.wait ?? wait;
  const request = async (path: string, method: string, body?: unknown, pushToken?: string) => {
    check();
    if (requestSignal.aborted) throw new Error("OneAuth request cancelled or timed out.");
    try {
      const headers: Record<string, string> = { Authorization: "Zoho-oauthtoken " + token, "Content-Type": "application/json" };
      if (pushToken) headers["Z-authorization"] = "Zoho-oauthtoken " + pushToken;
      const response = await fetch(endpoints(region).accounts + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: requestSignal, redirect: "error" });
      if (!response.ok) throw new Error("OneAuth request is not available to this OAuth client. Use the official Vault browser extension.");
      const result = object(await response.json());
      check();
      if (requestSignal.aborted) throw new Error("OneAuth request cancelled or timed out.");
      return result;
    } catch (err) {
      if (requestSignal.aborted) throw new Error("OneAuth request cancelled or timed out.");
      if (err instanceof Error && /^(OneAuth|Vault is locked|Unexpected OneAuth)/.test(err.message)) throw err;
      throw new Error("Could not contact OneAuth. Try again or use the official Vault browser extension.");
    }
  };

  const lookup = await request("/signin/v2/lookup/self?mode=extension", "POST");
  if (Number(lookup.status_code) !== 201 || !Array.isArray(lookup.lookup?.device)) throw new Error("OneAuth device lookup is unavailable to this OAuth client. Use the official Vault browser extension.");
  const devices = lookup.lookup.device as Record<string, unknown>[];
  const device = devices.find(d => d.is_primary === true || d.is_primary === "true");
  const deviceId = String(device?.device_id ?? "");
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(deviceId)) throw new Error("No primary OneAuth device is available for this account.");
  const base = "/api/v1/extension/self/device/" + encodeURIComponent(deviceId);
  const push = await request(base + "/push", "POST", { sendpushnotify: { app_id: oneAuthId } });
  const pushToken = push.sendpushnotify?.token;
  if (Number(push.status_code) !== 201 || typeof pushToken !== "string" || !pushToken) throw new Error("OneAuth could not send an approval request. Use the official Vault browser extension.");
  input.onWaiting?.();
  await delay(5000, requestSignal);
  for (let attempt = 0; attempt < 21; attempt++) {
    const result = await request(base + "/poll", "PUT", undefined, pushToken);
    if (Number(result.status_code) === 200 && result.code === "D101") {
      const code = result.verifypushnotify?.[0]?.totp;
      if (typeof code !== "string" || !/^\d{6,8}$/.test(code)) throw new Error("OneAuth approved but did not return a valid verification code.");
      return { code, source: "oneauth" };
    }
    if (Number(result.status_code) === 500 && result.errors?.[0]?.code === "D102" && attempt < 20) {
      await delay(3000, requestSignal); continue;
    }
    throw new Error("OneAuth request was declined, expired, or did not return a code.");
  }
  throw new Error("OneAuth approval timed out.");
}
