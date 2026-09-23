# Security

## Reporting a vulnerability

Report it privately with **Report a vulnerability** on this repository's Security tab: https://github.com/JordanIRL/EdgeExtension/security. Please don't open a public issue. Fixes ship as a new version on Edge Add-ons; only the latest version is supported.

## Design

- Manifest V3. No content scripts and no web-accessible resources. It accepts no messages from web pages or other extensions.
- No remote code: all code ships in the package. The Content Security Policy of the extension's pages allows scripts, styles and images from the package only, and network connections only to `https://login.microsoftonline.com/common/userrealm/`.
- No build step, bundler, minifier or third-party libraries. The package is `manifest.json`, `schema.json`, `src/` and `icons/` from this repository.
- The extension never sees sign-in requests or page content. Edge applies its `declarativeNetRequest` rules, which only add `login_hint` to sign-in requests on `login.microsoftonline.com`, `login.microsoft.com`, `login.windows.net` and `sts.windows.net`. The rules can't change the host, path or any other site.
- It fails closed. It removes its rules and leaves sign-ins alone when it's off or paused, when the profile has no account, when the account is personal or outside `allowedDomains`, when the work-or-school check hasn't succeeded, or when anything fails.
- It never runs in InPrivate windows (`"incognito": "not_allowed"`).

## Permissions

| Permission | Used for |
|---|---|
| `identity`, `identity.email` | Read the Edge profile account's email |
| `declarativeNetRequestWithHostAccess` | Add `login_hint` to sign-in requests. Edge applies the rules; the extension doesn't see the requests |
| Host permissions for the four sign-in hosts | The only hosts the rules can change. The domain check (a cookie-less `fetch` to `login.microsoftonline.com`) also needs it |
| `storage` | Settings, pause end time, the work/personal result for the account's domain; read administrator policy |
| `alarms` | End a pause; re-check the profile account every 5 minutes; retry a failed check every minute |

## Data

Nothing is sent to the publisher. [PRIVACY.md](PRIVACY.md) lists what's used, sent and stored. Removing the extension deletes everything it stored.

## Administrator control

- Install with `ExtensionInstallForcelist` or `ExtensionSettings` (`installation_mode: force_installed`, `update_url: https://edge.microsoft.com/extensionwebstorebase/v1/crx`). Removing it from policy uninstalls it.
- `ExtensionSettings` can block it (`blocked` or `removed`) or set `minimum_version_required`. A `runtime_blocked_hosts` entry covering the sign-in hosts stops it working. A per-extension entry doesn't inherit `runtime_blocked_hosts` from `"*"`, so other extensions can be kept off the sign-in hosts while this one is allowed.
- Extension policy (`schema.json`, see [README](README.md#enforcing-settings-with-policy)): `enabled`, `allowedDomains`, `allowPause`, `excludedSites`, `hintMode`, `accountPicker`, `includeFrames`.
- Updates come from Edge Add-ons and install automatically once Microsoft has certified them.

## Limitations

- It only chooses the account. It doesn't bypass MFA or Conditional Access, and it doesn't provide single sign-on.
- The work-or-school check uses Microsoft's undocumented `userrealm` endpoint. If that endpoint changes or fails, the extension stops acting until the check succeeds. Setting `allowedDomains` skips the check.
