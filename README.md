# Zoho Vault for Vicinae

An unofficial Vicinae extension to search personal Zoho Vault entries and copy
passwords, usernames, and time-based verification codes.

<img src="assets/zoho-vault-logo.svg" alt="Zoho Vault" width="260">

## Features

- Search entry names and websites; open websites from the launcher.
- Copy passwords, usernames and TOTP without adding them to Vicinae history.
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
| Copy password | Enter on a supported password entry |
| Copy username | Ctrl+U |
| Copy verification code | Ctrl+T |
| Lock immediately | Ctrl+L |
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

Supports `PBKDF2_AES` login and entries using the user's personal key
(`ISSHARED=NO`/`false`). Stored TOTP supports SHA1/SHA256/SHA512, 6–8 digits and periods
of 1–300 seconds. The generator matches all 18 RFC 6238 test vectors. Device time
must be accurate.

Organization/shared keys, legacy SHA256 vault login, linked Zoho OneAuth secrets,
HOTP, passkeys, attachments, browser autofill and editing are not implemented.
Unsupported records can be opened in Zoho Vault. Unexpected API response or
pagination formats fail explicitly. The pagination limit is 100 pages.

One free-plan India account confirmed read access; this is not proof of entitlement
for every account. Live account decryption and TOTP comparison still need an
end-to-end check with the user's own credentials.

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
