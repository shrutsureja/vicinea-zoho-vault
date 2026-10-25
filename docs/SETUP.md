# Complete setup guide

## 1. Install prerequisites

Install [Vicinae](https://docs.vicinae.com/install/linux), Node.js 22+ and npm.
This extension was built against Vicinae 0.29.2. Check your installations:

```sh
vicinae version
node --version
npm --version
```

**Lock on PC lock** requires Linux GNOME and `gdbus`. On Ubuntu the latter comes
from `libglib2.0-bin`. On other desktops, disable this setting. A Zoho CLI
subscription is not required.

## 2. Install the extension

Clone the repository, then install:

```sh
git clone https://github.com/shrutsureja/vicinea-zoho-vault.git
cd vicinea-zoho-vault
npm ci --ignore-scripts
npm run build
```

The final message should report a successful build and name Vicinae's extension
directory. Start Vicinae and search **Search Zoho Vault**. You do not need to copy
the source or `node_modules` into Vicinae.

## 3. Select your region and lock settings

In the extension's action panel, select **Extension Settings**. You can also reach
these preferences through Vicinae's extension settings.

1. Set **Zoho data center** to match your Vault website.
2. Select an **Automatic lock timer**.
3. Enable **Lock on PC lock** for GNOME; disable it on other desktops.
4. Close and reopen the extension to ensure the preferences are loaded.

| Vault hostname | Data center | API Console |
| --- | --- | --- |
| vault.zoho.in | India | https://api-console.zoho.in/ |
| vault.zoho.com | United States | https://api-console.zoho.com/ |
| vault.zoho.eu | Europe | https://api-console.zoho.eu/ |
| vault.zoho.com.au | Australia | https://api-console.zoho.com.au/ |
| vault.zohocloud.ca | Canada | https://api-console.zohocloud.ca/ |
| vault.zoho.jp | Japan | https://api-console.zoho.jp/ |
| vault.zoho.sa | Saudi Arabia | https://api-console.zoho.sa/ |
| vault.zoho.cn | China | https://api-console.zoho.cn/ |

An existing encrypted connection remembers its own region. To switch an existing
account, change the preference and use **Reconnect Account** with a new code.

## 4. Create or reuse a Self Client

1. Open the regional API Console from the table, or select **Open API Console**
   in the extension. Sign in with the same Zoho account you use for Vault.
2. Select **Get Started** on a first visit, or **Add Client** for an existing account.
3. Choose **Self Client**. If one already exists for your account, reuse it.
4. Open its **Client Secret** tab. Find the **Client ID** and **Client Secret**.

These OAuth client credentials differ from both your Zoho account password and
Vault master password. Keep them out of source files, Git commits, screenshots,
issue reports and chat.

## 5. Generate an authorization code

Open the Self Client's **Generate Code** tab:

1. In **Scope**, paste exactly:

   ```text
   ZohoVault.secrets.READ,ZohoVault.user.READ
   ```

2. Select **10 minutes** for expiry if offered.
3. Enter this plain description:

   ```text
   Read passwords from my Zoho Vault account
   ```

4. Click **CREATE**, completing any account/portal selection Zoho requests.
5. Copy the generated code and use it immediately in the next step.

Codes are **short lived and single use**. Generate a fresh code if one expired,
was used in the diagnostic, or was exchanged during a failed connection attempt.
The client ID and secret can be reused; the code cannot.

## 6. Connect and unlock

Open **Search Zoho Vault** and fill in:

| Field | What to enter |
| --- | --- |
| Client ID | From the Self Client's Client Secret tab |
| Client Secret | From the same tab |
| Fresh Code | The new authorization code |
| Master Password | Your **Vault master password**, which may differ from your Zoho account login password |

Press **Enter** to **Connect and Unlock** (or select it from the action panel). The
extension exchanges the code for tokens, verifies your master password locally,
loads entries, and saves an encrypted OAuth connection. Your master password is
not sent to Zoho. Normal future unlocks need only the master password; press Enter to submit.

If an error occurs after the code exchange, create a fresh code before retrying.
Unsupported entries remain listed with an action to open Zoho Vault.

## 7. Search, view details and copy

1. Unlock by entering your master password and pressing **Enter**. The returning
   unlock screen contains only that field; settings stay in the action panel.
2. Check the footer for the installed version and loaded-entry count. Clear the
   search to see all loaded entries; with a query the count shows matches/loaded.
   Search by login name, any returned URL, or username. Matching is case-insensitive;
   multiple words can match across these fields. Search stays on your PC.
3. Select a login and press **Enter** to load its latest details. This does not copy
   a password or open a browser automatically.
4. The left side has selectable action rows; the right side previews the login.
   Passwords remain masked. Use **Up/Down** to select a row and **Enter** to run it.
5. **Open Website** is the first row when a valid URL is available. It opens that
   URL in your browser. Other rows copy username, password, verification code, or URL.
6. **Alt+Left** returns to the search results. Select **Lock Vault** and press Enter,
   or press **Ctrl+L**, to lock immediately.

| Shortcut | Action |
| --- | --- |
| Ctrl+O | Open website from details |
| Ctrl+U | Copy username |
| Ctrl+P | Copy password |
| Ctrl+T | Copy Vault TOTP or request linked OneAuth approval |
| Ctrl+Y | Copy URL from details |
| Alt+Left | Back to search |
| Ctrl+L | Lock |

Personal and organization-key entries are supported. In Zoho, an organization-key
record is not necessarily shared with anyone. Restricted entries still require
Zoho's view/copy permission and any required checkout. Missing list fields are
not proof that an entry is unsupported: the extension re-fetches details before
copying. If the organization key cannot be retrieved, the status explains it.

Decrypted search names/usernames/URLs remain only in unlocked session memory and
are cleared from the active index on lock. Passwords and seeds are not indexed.
Copies use concealed clipboard entries and best-effort cleanup while running;
see [SECURITY.md](../SECURITY.md).

## 8. Vault TOTP and linked OneAuth

The details screen distinguishes **Vault TOTP** from **OneAuth**.

### Built-in Vault TOTP

The seed must already be stored inside the entry. Select **Verification Code** and
press Enter, or use **Ctrl+T**. The extension generates the current code locally and
copies it. The toast reports remaining validity. A copied code does not update:
copy again after the next time period begins. Compare the first live code with
Vault and ensure automatic device time is enabled.

Supported: encrypted otpauth TOTP with SHA1/SHA256/SHA512, 6–8 digits and 1–300-second
periods. The extension does not enroll accounts or create new TOTP seeds.

### Linked OneAuth

For an entry linked to a OneAuth secret, select **Request OneAuth Code**, or press
**Ctrl+T**. The extension attempts this flow only after your explicit action:

1. Locate your primary OneAuth device using your own OAuth token.
2. Send a push for the linked account.
3. Show **Waiting for phone approval**. Approve it on your OneAuth phone app.
4. Poll for the result and copy the returned code after approval. Use it immediately.

Use **Cancel OneAuth Request** in the action panel to stop waiting. Requests also
stop on vault lock, command closure or timeout. Denial never produces a copied
code. When both a stored Vault seed and a OneAuth link exist, the stored seed takes
precedence, matching the browser extension's choice.

**Availability:** this uses the flow found in Zoho's official browser extension,
not a documented public Vault API. Self Client/read-scope access is not yet verified
live. If your token cannot perform the lookup or request, the extension explains
that and you can use the official Vault browser extension. Do not paste browser
cookies, reuse Zoho's client identity, or invent broader scopes to work around it.

## 9. Configure locking

Open **Extension Settings**. Changes apply on the next unlock; close and reopen
the command after changing preferences if necessary.

| Setting | Behavior |
| --- | --- |
| 5 / 10 / 15 / 30 minutes | Lock that long after unlocking |
| 1 hour | Lock after 60 minutes |
| 1 day | Lock after 24 hours |
| No timer | Disable elapsed-time locking |
| Lock on PC lock | Independently lock when GNOME reports an active lock screen |

For **lock only when my PC locks**, choose **No timer** and enable **Lock on PC
lock**. For manual locking only, choose **No timer** and disable that checkbox.
When enabled, monitoring failures lock the vault and show a message.

Timers measure elapsed time, not inactivity. Every choice locks when the command
view/runtime closes or Vicinae restarts. No master key is written to disk to keep
unlock across restarts. Hiding the launcher may leave the command running.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Enter a valid description | Use the plain-letter description in step 5 |
| Invalid/expired code or authorization failed | Generate a new code in the matching regional console |
| Wrong scopes | Use the two exact read scopes above |
| Master password could not be verified | Check the Vault master password, keyboard layout and Caps Lock; replace a consumed setup code |
| Saved connection fails after a master-password change | Use **Reconnect Account**, a new code, and the new master password |
| PC-lock detection unavailable | Check GNOME and `gdbus`, or disable the setting and reopen the command |
| No verification method returned | Confirm a TOTP seed or OneAuth link is saved on the entry |
| OneAuth not available to this OAuth client | Use the official Vault browser extension; these endpoints may not allow your Self Client token |
| TOTP differs from Vault | Check automatic device time and custom algorithm/digits/period settings; never report the secret or URI |
| Organization key unavailable | Check Vault sharing approval and API permissions; missing key material cannot be guessed |
| Unsupported login algorithm | Legacy SHA256 login is not implemented; use the official Vault app |
| Password list or permissions rejected | Verify current account API access and scopes; failure alone does not prove an upgrade is necessary |
| Missing passwords after upgrading from v0.3.0 | v0.3.1 fixes skipped page zero. Close and reopen the command, unlock again and compare the loaded count with Vault |
| Command missing after build | Check the build output path and reopen Vicinae if needed |

## Disconnect and remove

Revoke the client's connected-app authorization in your Zoho account to remove
API access. Uninstall through Vicinae to remove the local extension. Uninstalling
alone does not revoke tokens. The extension never edits or deletes vault records.
