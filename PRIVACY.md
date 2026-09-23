# Privacy policy – Use My Profile Account

Last updated: 23 September 2026

Use My Profile Account is a Microsoft Edge extension. It has no servers, no analytics and no telemetry. The publisher receives no data from it.

## What it uses

- The email address of your Edge profile's account, read with Edge's `identity` API.
- Its settings, chosen by you or by your organization's policy.

## Where your data goes

- **Microsoft sign-in requests.** Your email is added as the sign-in hint (`login_hint`) to sign-in requests your browser is already making to `login.microsoftonline.com`, `login.microsoft.com`, `login.windows.net` and `sts.windows.net`. That includes background sign-ins in hidden frames unless they're turned off. Microsoft uses the hint to choose the account, as if you'd typed it.
- **Account-type check.** To confirm the account is a work or school account, the extension sends only your email's domain, as `user@<your domain>`, to `https://login.microsoftonline.com/common/userrealm/`, without cookies. It asks again only when your account's domain changes. If your organization limits the extension to its own domains (`allowedDomains`), no check is made.
- **Clear sign-in sessions** opens Microsoft's sign-out page (`https://login.microsoftonline.com/common/oauth2/v2.0/logout`) in a new tab, only when you click it. The extension adds nothing to that request.
- Nothing is sent anywhere else. The extension doesn't read pages, cookies or what you type, and it doesn't see the sign-in requests themselves: Edge applies its rules.

## What's stored, and for how long

- **Extension storage in this Edge profile:** your settings, the end time of the last pause, and whether your account's domain is a work or school domain. Kept until changed or until the extension is removed.
- **The extension's sign-in rules, saved in this Edge profile:** your email and any excluded sites, only while the extension is active. They're removed when it's turned off, paused or not used for your account.
- **Memory, until Edge closes:** your email, shown in the popup, the Settings page and the toolbar tooltip.
- Edge's browsing history keeps the addresses of sign-in pages, including the hint, as it does when a site adds the hint itself. Clearing browsing history removes them.
- Removing the extension deletes everything the extension stored.

The extension never runs in InPrivate windows.

## Your choices

- The popup and Settings page show which account is used.
- You can turn the extension off, pause it, exclude sites or clear sign-in sessions from the popup and Settings page, or remove it on `edge://extensions`.
- If your organization manages the extension, it can turn it on for you and hide or lock these controls.

## Contact

Open an issue at https://github.com/JordanIRL/EdgeExtension/issues. For security issues, see [SECURITY.md](SECURITY.md).
