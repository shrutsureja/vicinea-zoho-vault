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

Select **Connect and Unlock** through the primary action or action panel. The
extension exchanges the code for tokens, verifies your master password locally,
loads entries, and saves an encrypted OAuth connection. Your master password is
not sent to Zoho. Normal future unlocks need only the master password.

If an error occurs after the code exchange, create a fresh code before retrying.
Unsupported entries remain listed with an action to open Zoho Vault.

## 7. Search and copy

- Search by entry name or website URL.
- On a supported password entry, press **Enter** to copy its password.
- Press **Ctrl+U** to copy its username.
- Use **Open Website** to visit its HTTP/HTTPS URL.
- Use **Open Zoho Vault** for unsupported records and operations.
- Press **Ctrl+L** to lock immediately.

Passwords and usernames use concealed clipboard copies with a 30-second cleanup
attempt while the command is running. See [SECURITY.md](../SECURITY.md) for limits.

## 8. Copy TOTP verification codes

The TOTP seed must already be saved **inside the entry in Zoho Vault**. The
extension does not enroll a website in two-factor authentication or create seeds.

1. Select an entry and choose **Copy Verification Code**, or press **Ctrl+T**.
2. Paste the code into the website before it expires.
3. The toast reports remaining validity. A copied code does not change when the
   next period begins; copy again to get the next code.
4. For your first live test, compare it with the code shown in Zoho Vault. Ensure
   your computer's date/time is set automatically.

A `TOTP` label appears when the list response includes the encrypted TOTP field.
Some lists omit it, so the action is available for all personal-key entries and
checks their latest details when invoked.

Supported: encrypted `otpauth://totp` data with SHA1/SHA256/SHA512, 6–8 digits and
1–300-second periods. Organization/shared keys and linked OneAuth secrets are not
supported. A missing/unsupported secret shows an error rather than a guessed code.

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
| No TOTP secret returned | Confirm it is stored in the entry and is not a linked OneAuth secret |
| TOTP differs from Vault | Check automatic device time and custom algorithm/digits/period settings; never report the secret or URI |
| Organization key / unsupported login | Use **Open Zoho Vault**; shared keys and legacy SHA256 login are not implemented |
| Password list or permissions rejected | Verify current account API access and scopes; failure alone does not prove an upgrade is necessary |
| Command missing after build | Check the build output path and reopen Vicinae if needed |

## Disconnect and remove

Revoke the client's connected-app authorization in your Zoho account to remove
API access. Uninstall through Vicinae to remove the local extension. Uninstalling
alone does not revoke tokens. The extension never edits or deletes vault records.
