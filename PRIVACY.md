# Privacy policy – Use My Profile Account

Use My Profile Account is a Microsoft Edge extension. It has no servers, no analytics and no telemetry.

## What it uses

- **The email address of your Edge profile account**, read with Edge's `identity` API.

## How it's used

- The email is added as a sign-in hint (`login_hint`) to requests your browser is already making to Microsoft sign-in pages: `login.microsoftonline.com`, `login.microsoft.com`, `login.windows.net` and `sts.windows.net`. This tells Microsoft which account to sign you in with.
- The email is sent to Microsoft's public realm lookup (`https://login.microsoftonline.com/common/userrealm/`), without cookies, to check that it's a work or school account. The extension doesn't act for personal Microsoft accounts. The result is saved for each email so it isn't asked again.
- The extension doesn't read page content, doesn't see what you type on sign-in pages, and doesn't send data anywhere other than the Microsoft sign-in hosts listed above.

## What's stored

- Your settings, the realm lookup result and any pause time are kept in the extension's local storage in this Edge profile. The email also sits inside the extension's browser rules while it's active.
- All of it is deleted when you remove the extension.

## Contact

Questions about this policy: open an issue at https://github.com/JordanIRL/Edge-Extensions/issues.
