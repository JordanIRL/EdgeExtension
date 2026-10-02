# Security

## Reporting a vulnerability

Report it privately with **Report a vulnerability** on this repository's Security tab if enabled: https://github.com/JordanIRL/EdgeExtension/security. Please don't include credentials, tokens or session URLs in a public issue. Only the latest source version is supported; this repository does not claim store certification or enterprise approval.

## Design

- Manifest V3. No content scripts and no web-accessible resources. It accepts no messages from web pages or other extensions.
- No remote code: all code ships in the package. The Content Security Policy of the extension's pages allows scripts, styles and images from the package only, and network connections only to `https://login.microsoftonline.com/common/userrealm/`.
- No build step, bundler, minifier or third-party libraries. The package is `manifest.json`, `schema.json`, `src/`, `icons/` and the MIT license notice from this repository.
- This build does not read sign-in request contents or page content. Its DNR rules change only account/prompt query parameters on `login.microsoftonline.com`, `login.microsoft.com`, `login.windows.net` and `sts.windows.net`, never destinations or paths. Host permissions are security-sensitive capabilities; reviewers should inspect updates, not assume the code is technically incapable of accessing identity pages.
- It fails closed. It removes its rules and leaves sign-ins alone when it's off or paused, when the profile has no account, when the account is personal or outside `allowedDomains`, when the work-or-school check hasn't succeeded, or when anything fails.
- It never runs in InPrivate windows (`"incognito": "not_allowed"`).
- **Clear sign-in sessions** only opens Microsoft's sign-out page in a new tab (`chrome.tabs.create`, no extra permission). This build does not read/delete cookies or revoke tokens.

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
- Extension policy (`schema.json`, see [README](README.md#enterprise-deployment)): `enabled`, `allowedDomains`, `allowPause`, `excludedSites`.
- For store-deployed builds, updates are distributed through Edge Add-ons certification. Organizational approval and pilot testing are still required.

## Limitations

- It supplies an account hint, not an authentication or authorization guarantee. It doesn't bypass MFA/Conditional Access or provide single sign-on. Existing app sessions, session-bound renewals, broker flows and unreported profile changes are not immediately switched or enforced.
- Unsupported regexes and failed updates remove all rules; no safety guard or exception is silently dropped.
- Work-domain discovery uses Microsoft's undocumented `userrealm` endpoint. It cannot prove the profile's account type, especially on mixed personal/work custom domains. If discovery changes or fails, rules stay inactive. `allowedDomains` skips discovery and must contain organization-approved work domains.
