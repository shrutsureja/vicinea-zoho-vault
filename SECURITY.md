# Security and reporting

This is a preview integration. Automated tests use synthetic records and mocked
requests; they do not replace an independent review or a live account test. Report
security issues through the repository's private reporting channel if enabled.
Public reports must not include passwords, tokens, TOTP seeds, otpauth URIs,
account response dumps, or screenshots of credential forms.

## Storage and requests

The master password stays local and is not persisted. Client credentials, refresh
token and region are saved as an AES-256-GCM authenticated envelope in extension
LocalStorage, using scrypt with a random salt and a fresh random IV for each write.
A stolen envelope allows offline password guessing; use a strong master password.

Vault fields arrive encrypted and are decrypted locally. Requests go only to the
allowlisted Accounts and Vault hosts for the selected data center. Redirects are
refused. No remote favicons or telemetry are used. Opening a website is explicit
and sends no credentials. Raw server error bodies are not displayed or logged.
Form drafts are disabled. Required field values are included in the in-memory
submit payload; Vicinae's `storeValue` flag controls this inclusion, not disk storage.

Field decryption follows Zoho's published legacy AES-CTR format, without its own
authentication tag. The master key is verified against Zoho's encrypted JSON login
check. This extension cannot add integrity guarantees to that remote format. Local
credential storage uses authenticated AES-GCM separately.

## Sessions and clipboard

Keys remain in runtime memory until lock. Key Buffers are overwritten, but JavaScript
strings, runtime memory, swap and crash dumps cannot be reliably erased. Timers
measure time since unlock. Command/runtime exit always locks; unlock does not persist
across application or PC restarts. GNOME lock monitoring uses read-only `gdbus`
signals, polling and checks before unlocking/copying. It is not a universal desktop
lock detector. Monitoring failures lock the vault when that option is enabled.

Entries are re-fetched before copying to check current server permissions. Access
tokens renew for long sessions. Lock clears the token and renewal callback and
prevents in-flight requests from reopening the session.

Copies use Vicinae's concealed flag. Cleanup is attempted after 30 seconds, or TOTP
expiry if sooner, and on lock/unmount, only if the clipboard still matches the
last copy. Cleanup is best effort: an exited runtime cannot run timers, other
clipboard managers may ignore the flag, and clipboard read/clear is not atomic.

Only read scopes are requested. Shared/organization keys, linked OneAuth secrets
and legacy SHA256 login are unsupported. Changing the master password requires
reconnecting. Local uninstall does not revoke tokens; revoke authorization in Zoho.
