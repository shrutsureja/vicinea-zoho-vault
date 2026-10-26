# Project context for coding agents

This repository is an unofficial Zoho Vault extension for Vicinae, published at
https://github.com/shrutsureja/vicinea-zoho-vault. The package ID is
`zoho-vault-personal`; the visible command is **Search Logins**. Keep that ID
stable so upgrades preserve existing connection storage. The maintainer is
`shrutsureja`. The user requested the official Zoho Vault safe icon, configurable
locking, TOTP access, and a complete setup guide for other users.

## Commands and layout

Use Node.js 22+ and `npm ci --ignore-scripts`.

- `npm run check`: TypeScript, offline tests, then packaged build under `dist/`.
- `npm run build`: installs into the current user's Vicinae extension directory.
- `npm run dev`: watches changes; requires a running Vicinae instance.
- `src/search-vault.tsx`: connection/unlock UI, settings and clipboard handling.
- `src/vault.ts`: API requests, parsing, sessions, token renewal and copy actions.
- `src/crypto.ts`: Zoho field decryption and local encrypted credential envelope.
- `src/totp.ts`: validated otpauth TOTP generation.
- `src/oneauth.ts`: explicit, bounded and cancellable phone-approval requests.
- `src/settings.ts`: region allowlist and lock timer choices.
- `src/screen-lock.ts`: GNOME screen-lock monitoring through read-only gdbus.
- `docs/SETUP.md`: complete user setup and troubleshooting instructions.

## Credential and UI constraints

Never ask users to send passwords, client secrets, tokens, TOTP seeds or otpauth
URIs in chat, screenshots, issues, logs, or test fixtures. Use synthetic fixtures
and mocked requests. Do not read local Vicinae credential storage for debugging.
The first form intentionally combines OAuth connection and master-password unlock.
Master passwords are never sent to Zoho or persisted by extension code. Saved
connection credentials are authenticated/encrypted locally with scrypt/AES-GCM.

**Important Vicinae form behavior:** `Form.PasswordField.storeValue=false` excludes
the field from `Action.SubmitForm`'s payload. It does NOT merely disable persistence.
Do not apply that flag to required connection/unlock fields. Keep
`Form.enableDrafts=false` to disable draft storage. Clear validation errors on input
change: native validation can block later submissions while a field error remains.
The form regression test exercises these semantics without live credentials.

## Behavior to preserve

- The base connection uses `ZohoVault.secrets.READ,ZohoVault.user.READ`. OneAuth
  Accounts endpoint availability is experimental; do not guess additional scopes.
- Codes from Self Client are short-lived and single-use; retrying after a code
  exchange may require a fresh code. Never hard-code a user's code or client secret.
- Regions are allowlisted; default India. Existing encrypted connections retain
  their saved region. Changing region requires reconnecting.
- Support PBKDF2_AES vaults, personal keys and organization keys (legacy CSV/hex
  RSA-PKCS1-v1.5 and base64 PKCS#8 RSA-OAEP/SHA-256). Organization-key records need
  not be shared to anyone. Respect view/copy levels and access-control checkout.
  Legacy SHA256 login, HOTP, passkeys, editing and attachments remain unsupported.
- Search shows details inline (List isShowingDetail, Ctrl+D toggles) built from the
  session index; there is no separate details screen. Enter copies the password,
  Shift+Enter the username (Ctrl+P/Ctrl+U also kept); actions are grouped Copy/Open/
  Vault with the same shortcuts on every row. Password previews stay masked. Unlock
  submits with plain Enter; selectable Lock Vault rows also use Enter. Keep the
  returning unlock form description-free (context goes in navigationTitle). Row
  icons are locally tinted Icon.Key, never remote favicons.
- Search matches names, all returned URLs and usernames across words, locally and
  case-insensitively. Decrypted index data is session-only; never index passwords.
- Zoho secrets pagination is zero-based (`pageNum=0` first). Never start at 1:
  it silently skips the first page. Validate against `operation.meta.secretcount`
  when available and show loaded/filter counts plus time-to-lock in the footer.
- Missing list fields must not become blanket unsupported labels. Re-fetch details
  before copying. Keep specific status messages for unavailable keys/permissions.
- OneAuth links use an explicit push-and-poll action (src/oneauth.ts), with the
  user's own token. This browser-extension flow is not public API; live scope
  availability is unconfirmed. Never copy third-party OAuth credentials or browser
  cookies. Abort on lock/cancel/timeout; never copy after denial or a late result.
- TOTP is an encrypted top-level `totp` field containing an otpauth URI. Support
  SHA1/SHA256/SHA512, 6–8 digits and configured periods; do not guess unknown formats.
  Zoho's encrypted empty value is a 12-character base64 nonce, not a stored seed.
  Exclude it from hasTotp so linked OneAuth remains available. Inline details avoid
  a second list where the search query could hide field actions.
- Lock choices are elapsed time since unlock: 5/10/15/30 minutes, 1 hour, 1 day,
  or no timer. PC-lock detection is separate and currently GNOME-only. Monitoring
  failures lock the vault when enabled. Closing the command/runtime always locks.
- Re-fetch entries before copying; check current permissions and session state
  after asynchronous work. Token refresh must not reopen a locked session.
- Use concealed clipboard copies and best-effort expiry cleanup, without clearing
  unrelated replacement clipboard content. Never promise guaranteed clipboard erasure.
- Keep drafts disabled, avoid remote favicons/telemetry, refuse HTTP redirects,
  and never show raw API response bodies in error messages.

## Verification and sharing

Run `npm run check` for code changes. Update the locally installed extension with
`npm run build` when working on the user's installed copy. Build-generated
`vicinae-env.d.ts`, `dist/`, `node_modules/`, environment files and credential files
are ignored. Keep setup instructions current when changing visible behavior.
Logo attribution is in `THIRD_PARTY_NOTICES.md`; Zoho artwork is excluded from MIT.

Automated tests cover synthetic decryption vectors, RFC 6238 vectors, timers,
region selection, token renewal, lock parsing, form/details interactions,
organization-key envelopes, username search, OneAuth approval/cancellation and API
failures. A read-only GNOME
monitor smoke check succeeded on the original development machine. The user's
free India account confirmed API reads. These do not prove universal plan
entitlement or successful end-to-end decryption/TOTP for every live account.
Distinguish automated checks from live user verification when reporting results.
