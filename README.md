# Zoho Vault for Vicinae

An unofficial Vicinae extension to search Zoho Vault entries and copy
passwords, usernames, and time-based verification codes.

<img src="assets/zoho-vault-logo.svg" alt="Zoho Vault" width="260">

## Features

- Search names, all returned website URLs and decrypted usernames locally.
- Show the installed version and loaded/matching entry counts in the footer.
- Press Enter to view a login, then use arrow-key rows and a side preview.
- Open the website first, or copy a username, password, TOTP or URL.
- Copy without adding secrets to Vicinae history.
- Generate Vault TOTP locally, or explicitly request a linked OneAuth code.
- Unlock both personal-key and organization-key password records.
- Lock after 5, 10, 15 or 30 minutes, 1 hour, 1 day, or choose no timer.
- Optionally lock when your GNOME desktop locks.
- Encrypt saved OAuth connection credentials with your master password.
- Select any of the eight documented Zoho data centers.

## Setup

**[Complete installation and setup guide](docs/SETUP.md)** — includes the Zoho
Self Client, scopes, connection, settings, TOTP, and troubleshooting.

Requires Vicinae 0.29.2 or compatible, Node.js 22+, npm, and working Vault read API
access. PC-lock detection additionally needs Linux GNOME and `gdbus`; disable that
setting on other desktops.

Clone the [source repository](https://github.com/shrutsureja/vicinea-zoho-vault), then install:

```sh
git clone https://github.com/shrutsureja/vicinea-zoho-vault.git
cd vicinea-zoho-vault
npm ci --ignore-scripts
npm run build
```

Open **Search Zoho Vault** in Vicinae. Create a fresh Self Client authorization code
with scopes `ZohoVault.secrets.READ,ZohoVault.user.READ`, then enter the client ID,
client secret, code, and Vault master password in the extension's form.

| Action | Shortcut |
| --- | --- |
| Unlock | Enter on the master-password form |
| View login details | Enter on a search result |
| Run the selected details action | Enter; use ↑/↓ to select |
| Open website | Ctrl+O inside details |
| Copy password | Ctrl+P |
| Copy username | Ctrl+U |
| Copy Vault TOTP / request linked OneAuth code | Ctrl+T |
| Copy URL | Ctrl+Y inside details |
| Back to search | Alt+Left |
| Lock immediately | Ctrl+L, or Enter on the Lock Vault row |
| Change preferences | Action panel → Extension Settings |

## Lock behavior

Timers measure **elapsed time since unlock**, not inactivity. Settings apply on the
next unlock. PC-lock detection is a separate checkbox: choose **No timer** plus
**Lock on PC lock** to keep the vault unlocked until the desktop locks, the command
closes, or you lock manually. Long-running sessions renew OAuth access tokens.

All choices keep keys only in memory. Closing the command/runtime, restarting
Vicinae, or restarting the PC always requires another unlock. Hiding the launcher
may leave its view running. A one-day timer does not preserve unlock across restarts.

## Supported data and limitations

Supports `PBKDF2_AES` login with personal and organization keys. Zoho may encrypt
an entry with the organization key even if it is not shared with anyone. Legacy
RSA-PKCS1-v1.5 and modern RSA-OAEP/SHA-256 organization-key envelopes are supported.
View/copy permissions and access-control checkout restrictions are respected.

Search decrypts usernames, encrypted names and URLs in memory after unlock. It
never indexes passwords or TOTP seeds and never sends search queries to Zoho.
Records whose list metadata is incomplete are fetched when opened or copied.

Vault TOTP supports SHA1/SHA256/SHA512, 6–8 digits and periods of 1–300 seconds.
The generator matches all 18 RFC 6238 test vectors. Device time must be accurate.
For a linked OneAuth entry, **Request OneAuth Code** sends a push only when invoked,
waits for phone approval, and copies the returned code. Local Vault TOTP takes
precedence when both methods are configured. Requests can be cancelled and are
aborted on lock. This flow follows the official browser extension's Accounts
endpoints, which are outside the public Vault API contract; availability for a
Self Client/read token needs a live account check. On permission rejection, use
the official Vault browser extension. No browser cookies or Zoho-owned OAuth
client credentials are used, and no additional scope names are guessed.

Legacy SHA256 vault login, HOTP, passkeys, attachments, browser autofill and editing
remain unimplemented. Unknown key formats and restricted entries show specific
status messages. API response/pagination errors fail explicitly; the limit is
100 pages. Organization-key availability depends on the account's approved key
material and API permissions.

One free-plan India account confirmed API reads and reached the login list. This
is not proof of entitlement for every account. Automated checks use synthetic
records; live password/TOTP/OneAuth verification still needs the user's own account.

## Development and sharing

```sh
npm ci --ignore-scripts
npm run check
npm run dev
```

`check` runs type checking, synthetic/mock tests and a distributable build into
`dist/`. `build` installs locally; `dev` watches sources with Vicinae running.
GitHub Actions runs the same checks. See [CONTRIBUTING.md](CONTRIBUTING.md).

This directory is ready for Git. Review files before making your first commit:

```sh
git init -b main
git status --short
git add .
git diff --cached --stat
git commit -m "Add Zoho Vault extension for Vicinae"
```

Share this repository: [https://github.com/shrutsureja/vicinea-zoho-vault](https://github.com/shrutsureja/vicinea-zoho-vault).
For the Vicinae Store, follow the current submission instructions at
[vicinaehq/extensions](https://github.com/vicinaehq/extensions).

## Security and attribution

Read [SECURITY.md](SECURITY.md) for credential storage and clipboard limitations.
Source is under the [MIT license](LICENSE). Zoho's artwork and marks remain Zoho's
property; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). This is not affiliated
with or endorsed by Zoho or Vicinae.

Protocol references:

- [Password APIs](https://www.zoho.com/vault/api/password-management.html)
- [Key derivation and vault flow](https://www.zoho.com/vault/api/supported-operations.html)
- [Regional endpoints](https://www.zoho.com/vault/api/api-endpoint.html)
- [Self Client flow](https://www.zoho.com/developer/oauth/self-client/authorization-code-flow.html)
- [Zoho decryption example](https://help.zoho.com/portal/en/kb/zohorpa/how-to-s-and-tutorials/articles/how-to-use-passwords-in-rpa-flows-from-zoho-vault)
- [Vicinae clipboard API](https://docs.vicinae.com/extensions/api/clipboard)
- [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238)
