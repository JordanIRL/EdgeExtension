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

Use My Profile Account makes Microsoft 365, Azure, SharePoint and other Microsoft Entra sign-ins use the work or school account of the Edge profile you're using — instead of the Windows account or an account picker.

It's built for people with more than one work account on the same PC. Give each account its own Edge profile, and each profile signs in as itself.

• Adds your profile's account as the sign-in hint on Microsoft's sign-in pages, and leaves sites that already chose an account alone.
• Skip or show the account picker, exclude sites, and pause for 15 minutes or an hour when you need another account.
• Does nothing for personal Microsoft accounts and never runs in InPrivate windows.
• No telemetry. The extension can't read pages; only your account's domain is checked to confirm it's a work or school account.
• Administrators can enforce settings and limit it to their domains with Edge policy.

The extension chooses the account; it doesn't bypass MFA or Conditional Access.
