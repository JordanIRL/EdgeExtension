# Use My Profile Account

A Microsoft Edge extension that signs you in to Microsoft sites with **the work or school account of the Edge profile you're using**, not the Windows account and not an account picker.

On an Entra-joined Windows 11 PC where bob@example.com signs in to Windows:

| Edge profile | Signed in to Edge as | Microsoft 365, Azure, SharePoint… sign in as |
|---|---|---|
| Profile 1 | bob@example.com | bob@example.com |
| Profile 2 | mary@example.com | mary@example.com |

Install the extension in every profile you want this in. Each copy uses its own profile's account.

## How it works

Microsoft's sign-in service chooses the account from the `login_hint` parameter of the sign-in request. The extension adds `login_hint=<profile email>` to sign-in requests using Edge's `declarativeNetRequest` rules. It can't read pages and runs no code on them. It reads your profile's email with Edge's `identity` API.

The rules are careful about what they change:

- **Kept as the site sent it:** requests where the site already chose an account (`login_hint`, `username`, `sid`, `id_token_hint`), sign-up requests (`prompt=create`), and anything that isn't the start of a sign-in.
- **Filled in:** an *empty* `login_hint=` is filled in where it stands, never added a second time. The Azure, Entra and Intune portals send an empty one, which is what broke the older [UseMyCurrentAccount](https://github.com/novotnyllc/UseMyCurrentAccount) extension in 2025, and Microsoft rejects a duplicated hint.
- **Covered:** OAuth / OpenID Connect (`/oauth2/authorize`, `/oauth2/v2.0/authorize`), SAML (`/saml2`, including POST binding) and WS-Federation (`/wsfed`) on `login.microsoftonline.com` and its aliases.
- **Work or school accounts only.** If a profile uses a personal Microsoft account (outlook.com, gmail.com, icloud.com and similar), the extension does nothing in that profile. It asks Microsoft's public realm lookup and remembers the answer for each email. Until that check succeeds (for example while offline) it does nothing.
- **Never touched:** personal-account sign-ins, even in a work profile. That covers `/consumers`, `login.live.com`, requests with `domain_hint=consumers`, and sign-ins that return to consumer sites such as outlook.live.com. Azure AD B2C and Entra External ID (`*.b2clogin.com`, `*.ciamlogin.com`) are also left alone, because they use app-specific accounts.

Each sign-in gets one extra internal redirect, visible in DevTools as `307 Internal Redirect`.

## Install

**Try it (developer mode):**

1. Download or clone this folder.
2. Open `edge://extensions`, turn on **Developer mode**, click **Load unpacked** and select the folder that contains `manifest.json`.
3. Repeat in each Edge profile.

**Deploy to an organization:**

1. Package the extension. From this folder, in a Windows command prompt or PowerShell:

   ```powershell
   tar.exe -a -c -f UseMyProfileAccount.zip manifest.json schema.json src icons
   ```

   (`tar.exe` is built into Windows 10 and 11. Windows PowerShell 5.1's `Compress-Archive` can write backslash paths that the store rejects.)
2. Publish it on [Edge Add-ons](https://partner.microsoft.com/dashboard/microsoftedge) (Partner Center). Choose **Hidden** visibility if you don't want it to be searchable. For the privacy policy URL, use the web link to `PRIVACY.md` in this repository. See [Store submission notes](#store-submission-notes) for the permission justifications. Hosting it there is the most reliable option: self-hosted extensions can't always be force-installed on Entra-joined devices that aren't hybrid-joined.
3. Force-install it with Intune: **Devices › Configuration › Create › Windows 10 and later › Settings catalog › Microsoft Edge › Extensions › Control which extensions are installed silently**, with the value
   `<extension ID>;https://edge.microsoft.com/extensionwebstorebase/v1/crx`.
   A force-installed extension is added to every profile on the device.
4. Start with a pilot group. Test the sign-ins your users depend on, including admin portals, SharePoint, SAML apps and guest (B2B) access, before rolling out widely.

## Using it

Click the toolbar icon to see which account is being used. From there you can:

- **Turn it on or off** for this profile.
- **Pause for 15 minutes or 1 hour** when you need to sign in with a different account. Apps that remember the account you picked keep using it. Other sites go back to the profile account the next time they sign you in, so add sites you always use with a different account (for example a customer's SharePoint) to **Excluded sites**.
- **Open Settings.**

The icon shows the state:

- A green check means it's working.
- A grey pause icon means it's paused, off (with an **OFF** badge), or not used for this account (a personal account, or a domain your organization didn't allow).
- An orange **!** means it needs attention, for example because the profile isn't signed in.

### Settings

| Setting | Default | What it does |
|---|---|---|
| When a site already asks for a specific account | Keep the site's choice | **Always use this profile's account** replaces a hint the site sent for a different account. |
| When a site asks you to pick an account | Skip the picker | Some sites (for example Outlook on the web) always ask for the account picker. Choose **Show the account picker** to respect that. |
| Background sign-ins in hidden frames | On | Also applies to the silent sign-ins apps run in the background. |
| Excluded sites | none | Sign-ins that start from or return to these sites are left alone, for example `dev.azure.com`. |

## Enforcing settings with policy (administrators)

Settings can be enforced for every profile on a device. Enforced settings are locked in the extension's pages and show as *Managed*. Policy can't set a single email, because it applies to every profile. Each profile always uses its own account.

| Policy | Type | Values |
|---|---|---|
| `enabled` | boolean | Turns the extension on or off. Users can't change it. |
| `hintMode` | string | `missing` (keep a site's choice) or `always` |
| `accountPicker` | string | `skip` or `site` |
| `includeFrames` | boolean | Include background sign-ins in hidden frames |
| `excludedSites` | list of strings | Replaces the user's excluded sites |
| `allowPause` | boolean | Show the Pause buttons (default `true`) |
| `allowedDomains` | list of strings | Only act for accounts in these domains, for example `contoso.com` (subdomains included). Handy for limiting it to your organization's accounts. |

Values live under
`HKLM\SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\<extension ID>\policy`.
Booleans are `REG_DWORD` 0/1, strings are `REG_SZ`, and lists are a subkey with `REG_SZ` values named `1`, `2`, `3`…

- **Intune:** edit and deploy [`admin/Set-ExtensionPolicy.ps1`](admin/Set-ExtensionPolicy.ps1) as a platform script running as SYSTEM. Intune's Settings catalog and ADMX import can't write extension policy.
- **Group Policy or testing:** see [`admin/example-policy.reg`](admin/example-policy.reg).
- **Check it:** open `edge://policy` and click **Reload policies**. A value with the wrong type is ignored and won't appear there. The extension ID is shown on `edge://extensions`.

## Edge settings that also matter

- **Automatic profile switching** (`edge://settings/profiles/multiProfileSettings`) can move a Microsoft site into a different profile before this extension sees it. Turn it off, or set those sites to *No preference* (policy `AutomaticProfileSwitchingSiteList`, or `GuidedSwitchEnabled` = 0).
- **Single sign-on without a password prompt:** the extension picks the account, but it doesn't create single sign-on. For Mary to sign in silently on Bob's PC, add her account under **Windows Settings › Accounts › Access work or school**. Otherwise she signs in once per profile and the profile remembers it.
- **"Allow single sign-on for work or school sites using this profile"** lets personal or local profiles use the Windows work account. Leave it off in profiles that should never use the Windows account.
- **Profile sign-in:** each profile needs to be signed in to Edge with a work or school account. `BrowserSignin` = 0 and on-premises-only profile sign-in leave Edge without a profile email.
- **InPrivate:** allow the extension in InPrivate on `edge://extensions` if you want it there.
- **Remove the old UseMyCurrentAccount extension** if it's installed. It's Manifest V2, which Edge is retiring.

## Limitations

- Apps that get tokens straight from Windows (Microsoft's Web Account Manager, WAM), rather than through the sign-in page, aren't affected.
- The extension only chooses the account. It doesn't bypass MFA or Conditional Access.
- If you set the extension's site access to *On click*, the popup offers to allow it again. A `runtime_blocked_hosts` policy covering the sign-in hosts also stops it, and the extension can't detect that.
- A site that sends the hint parameter in unusual letter case (for example `LOGIN_HINT=`) gets a second hint, which Microsoft rejects (AADSTS9000411). Microsoft's own libraries always use lower case. If you hit this, add the site to *Excluded sites*.

## Troubleshooting

- **The popup says "No account to use":** the profile isn't signed in to Edge. Sign in with a work or school account.
- **The popup says "Not used for personal accounts":** the profile is signed in with a personal Microsoft account, so the extension stays idle.
- **The popup says "Checking your account":** the extension couldn't reach Microsoft to confirm the account type (offline, captive portal or proxy). It tries again every minute and does nothing meanwhile.
- **Still seeing the account picker:** check that the popup shows the right account and isn't paused. Then check whether Automatic profile switching moved the tab to another profile.
- **An app shows an error after sign-in:** add the app's site to *Excluded sites*, or pause, and please report it.
- **See what happened:** open DevTools (F12) › Network on the sign-in page, turn on *Preserve log*, and look for the `307 Internal Redirect` to `login.microsoftonline.com` with `login_hint` added.

## Development

```
manifest.json       Manifest V3
schema.json         Policy (managed storage) schema
src/background.js   Service worker: reads the account, keeps the rules up to date
src/rules.js        Builds the declarativeNetRequest rules (pure, unit tested)
src/settings.js     Settings, policy merging, shared helpers
src/popup.*         Toolbar popup
src/options.*       Settings page
tests/              Rule tests with a small declarativeNetRequest simulator
admin/              Policy script and .reg example
```

Run the tests with `sh tests/run.sh` on macOS. It uses the built-in JavaScriptCore; on other systems, run `node tests/rules.test.js` with Node 22.7 or later. For Edge's regex size limit, `pip install google-re2` adds an RE2 check of every generated rule. After changing code, reload the extension on `edge://extensions`.

## Store submission notes

Partner Center asks for a reason for each permission:

| Permission | Why |
|---|---|
| `identity`, `identity.email` | Read the email of the Edge profile's account, to use as the sign-in hint. |
| `declarativeNetRequestWithHostAccess` and the four Microsoft sign-in hosts | Add `login_hint` to sign-in requests on Microsoft's sign-in pages only. No other sites are accessed. |
| `storage` | Save the user's settings, the pause time and the cached account-type result. |
| `alarms` | End a pause on time, and re-check the profile account every few minutes. |

Single purpose: sign in to Microsoft sites with the work or school account of the current Edge profile. No remote code, no data collection.

Privacy: see [PRIVACY.md](PRIVACY.md).
