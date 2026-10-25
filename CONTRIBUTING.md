# Contributing

Use Node.js 22+ and npm:

```sh
npm ci --ignore-scripts
npm run check
```

This runs TypeScript checks, synthetic/mock tests and a build into `dist/` without
Zoho credentials, a desktop bus or a running Vicinae instance. GitHub Actions runs
the same checks on pushes and pull requests. Use `npm run dev` with Vicinae running
for local UI development. Enter credentials only through the extension.

Source map:

- `src/search-vault.tsx`: UI, settings, connection and clipboard lifecycle.
- `src/vault.ts`: API calls, entry parsing, sessions and token renewal.
- `src/crypto.ts`: Zoho decryption and local credential envelope.
- `src/totp.ts`: TOTP URI validation and generation.
- `src/oneauth.ts`: explicit push requests and bounded approval polling.
- `src/screen-lock.ts`: GNOME lock monitoring.
- `src/settings.ts`: region allowlist and timer choices.

Use synthetic data for tests. Keep credentials, private account responses, otpauth
URIs and private screenshots out of commits. Keep API errors free of response
bodies. Reject unknown crypto formats, permissions and pagination rather than
silently guessing. Add regression tests for behavioral changes and update the setup
guide for user-facing changes.

Before submitting to the Vicinae Store, follow its current submission rules.
Keep the package name stable to preserve installed extension storage on updates.
