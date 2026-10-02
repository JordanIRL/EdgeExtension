# Store listing assets

Images for the Edge Add-ons listing (Partner Center › your extension › Store listings). They contain only example accounts (`example.com`) and are rebuilt from the real extension UI.

| File | Size | Where it goes |
|---|---|---|
| `logo-300x300.png` | 300 × 300 | Extension logo (required) |
| `screenshot-1-1280x800.png` … `screenshot-5-1280x800.png` | 1280 × 800 | Screenshots (up to 6), in this order |
| `tile-small-440x280.png` | 440 × 280 | Small promotional tile (optional) |
| `tile-large-1400x560.png` | 1400 × 560 | Large promotional tile (optional) |

For the GitHub repository's social preview, upload [`../docs/images/social-preview-1280x640.png`](../docs/images/social-preview-1280x640.png) under **Settings › General › Social preview**.

## Suggested listing text

**Short description** comes from `manifest.json`.

**Description:**

Use My Profile Account prefers the work or school account of the current Edge profile on new Microsoft Entra sign-ins, including Microsoft 365, Azure and SharePoint, and removes supported account-picker requests.

It's built for people with more than one work account on the same PC. Give each account its own Edge profile. There are no conflicting account-selection settings: the profile account is always the hint used on supported new sign-ins.

• Replaces another account hint with the profile account and skips supported selector prompts, without removing required login or consent.
• Opens Microsoft's sign-out page, excludes sites when needed, and provides a 15-minute troubleshooting pause.
• Does nothing for personal Microsoft accounts and never runs in InPrivate windows.
• No telemetry, content scripts or cookie access. Only your account's domain is sent for a work-domain eligibility check; the publisher receives no data.
• Administrators can enforce settings and limit it to their domains with Edge policy.

Silent sign-in depends on an available Microsoft session and organization policy. This helper doesn't bypass MFA/Conditional Access, replace existing website sessions, or guarantee the selected account. Microsoft's sign-out page does not clear all cookies or tokens. See the README for scope and limitations.
