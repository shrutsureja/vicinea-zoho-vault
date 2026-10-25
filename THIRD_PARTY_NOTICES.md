# Third-party notices

## Zoho branding

`assets/zoho-vault-logo.svg` comes from the user-supplied official URL:
https://www.zohowebstatic.com/sites/zweb/images/productlogos/vault.svg

`assets/zoho-vault-icon.svg` uses its safe symbol with the wordmark removed and a square
viewBox. The symbol's paths and colors are preserved. Zoho artwork and marks remain
Zoho Corporation's property and are excluded from this project's MIT license.
Their use identifies the service; it does not imply affiliation or endorsement.

## Protocol research and dependencies

Zoho's API guide, key-derivation example and official Firefox extension 6.10.1 were
inspected to understand encrypted fields and TOTP URI formats. No Zoho JavaScript
implementation is bundled. TOTP was independently implemented from RFC 6238 and
checked against its published test vectors.

Packages listed in `package.json` and `package-lock.json` retain their own licenses.
