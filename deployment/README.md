# Use My Profile Account — internal deployment kit

Deploy version **1.2.1** as a signed CRX3 extension with HTTPS updates, using Microsoft Edge's `ExtensionSettings` policy. The included ZIP is an administrator's kit: extract it before use. It is not an Intune application installer, and uploading the ZIP to Intune does not install an Edge extension.

The extension prefers the work account signed into the current Edge profile on supported Microsoft Entra sign-in requests. It requires no Microsoft Graph permissions, app registration or tenant consent. It does not bypass passwords, MFA, consent or Conditional Access, or switch existing website sessions. See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Files and release identity

| File | Purpose |
|---|---|
| `extension/UseMyProfileAccount.crx` | Signed package for private hosting and policy installation. |
| `extension/source/` | The 19 runtime files used to build the package. |
| `extension/UseMyProfileAccount.zip` | Runtime source ZIP for the optional Edge Add-ons route. |
| `hosting/updates.xml.template` | Private update-manifest template. |
| `policy/ExtensionSettings.private.json.template` | Installation policy for the private extension ID. |
| `policy/ExtensionSettings.store.json.template` | Installation policy for a future Edge Add-ons ID. |
| `scripts/Configure-Hosting.ps1` | Generates `hosting/updates.xml` and `policy/ExtensionSettings.private.json` for your HTTPS address. |
| `scripts/Set-ExtensionPolicy.ps1` | Optional machine policy for this extension's own settings. |
| `release-info.json` | Private extension ID, version and CRX SHA-256. |
| `LICENSE.md`, `PRIVACY.md`, `SECURITY.md` | License, data handling and security boundaries. |

This release's private extension ID is **`lbohpojbnjhjpobcgkknhccfmahnfplp`**. Confirm it against `privateExtensionId` in `release-info.json` for every private deployment setting. The private signing key determines that ID; an Edge Add-ons listing has a different ID, and an unpacked development copy can also have a different ID. Verify the installed ID rather than copying an ID from an earlier screenshot.

From the extracted kit, check the signed package before publishing it:

```powershell
$release = Get-Content .\release-info.json -Raw | ConvertFrom-Json
$hash = (Get-FileHash .\extension\UseMyProfileAccount.crx -Algorithm SHA256).Hash
if ($hash -ne $release.crxSha256) { throw 'CRX hash does not match release-info.json.' }
$release | Select-Object privateExtensionId, version, crxSha256
```

## 1. Confirm deployment eligibility

Use a managed Windows 11 device and a supported Edge build, with the intended work account signed into Edge. Intune enrollment alone is not proof of the device's join state.

The current [ExtensionSettings policy reference](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/extensionsettings) permits Windows force installation from outside Edge Add-ons when the device is AD domain joined **or Microsoft Entra joined**. The [older self-hosting guide](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-manage-extensions-webstore) still states that Entra-only devices are unsupported and requires AD/hybrid join. These Microsoft pages conflict. Follow the current policy reference, but verify silent installation **and a subsequent update** on each join type and Edge channel you intend to support before rollout. This kit does not assert a successful customer tenant deployment. Documentation checked 4 October 2026.

Review the effective Edge extension restrictions and choose one owner for `ExtensionSettings`. Preserve existing extension entries and any existing `"*"` defaults. Do not add machine-wide allow/block wildcards to deploy this extension.

## 2. Configure and publish HTTPS files

Run the helper from the extracted kit, following your organization's PowerShell signing and execution policy:

```powershell
.\scripts\Configure-Hosting.ps1 -BaseUrl 'https://extensions.example.com/use-my-profile-account'
```

Replace the example with a hosting location reachable by pilot devices. Review the two generated files, then publish:

| Local file | HTTPS location | Content-Type |
|---|---|---|
| `hosting/updates.xml` | `<BaseUrl>/updates.xml` | `application/xml` or `text/xml` |
| `extension/UseMyProfileAccount.crx` | `<BaseUrl>/UseMyProfileAccount.crx` | `application/x-chrome-extension` |

Both endpoints must allow anonymous downloads with a trusted HTTPS certificate. A sign-in page, authentication challenge or HTML error response prevents unattended installation. Edge does not send cookies with update-manifest requests. Check access from the pilot network and remote device locations. Publish only the required XML and CRX files. [Hosting and update guidance](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/auto-update).

The XML `appid` must match `privateExtensionId`; its `version` must match the manifest inside the CRX and `release-info.json`. Its `codebase` must be the actual CRX URL. Download the hosted CRX and verify its hash against the local release. Configure the CRX MIME type explicitly; Microsoft identifies an incorrect header as a cause of silent-install failure. [Deployment troubleshooting](https://learn.microsoft.com/en-us/troubleshoot/microsoft-edge/development/self-host-extension-deploy).

## 3. Install through Intune

1. In Intune, open **Devices → Configuration** and create or edit the Windows **Settings catalog** profile that owns your Edge extension management policy.
2. Select **Microsoft Edge → Extensions → Configure extension management settings**, using the device setting, and enable it.
3. Merge the entry from `policy/ExtensionSettings.private.json` into the existing policy JSON. Keep the private ID, `"installation_mode": "force_installed"`, the generated `update_url`, and `"override_update_url": true`. Preserve other extension entries and defaults; resolve overlapping Intune/GPO policies before assigning.
4. Supply the complete merged JSON value. If a single line is required, compact your reviewed JSON with `ConvertTo-Json -Depth 20 -Compress`.
5. Assign to a **pilot device group** first. Sync the pilot devices and complete the validation below before expanding assignment.

The Settings catalog controls Edge installation; the signed CRX is downloaded from your HTTPS host. No Win32 wrapper or Developer mode installation is required for this route. [Microsoft's Intune Edge configuration guide](https://learn.microsoft.com/en-us/deployedge/configure-edge-with-intune).

Keep `override_update_url` enabled for private hosting so subsequent updates continue to use your policy URL. Update checks are periodic; policy arrival does not guarantee an immediate package download. [Update troubleshooting](https://learn.microsoft.com/en-us/troubleshoot/microsoft-edge/development/self-host-extension-update).

### Alternative: Microsoft Edge management service

In the Microsoft 365 admin center, go to **Settings → Microsoft Edge**, open the pilot configuration policy, and add an **External extension** using `privateExtensionId`. Set installation to **Force**, supply the generated `updates.xml` URL, and enable using that URL for subsequent updates. Save and assign to the intended pilot users; device targeting is available through the Intune profile route. You may instead merge/import the generated JSON after exporting and preserving the existing settings. Import can overwrite previous extension configuration. [Extension management](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-management-service-extensions).

Check the effective policy source on the pilot. Existing Intune/GPO settings can take precedence over cloud policy; avoid deploying competing values through both routes. [Policy assignment and precedence](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-management-service).

## 4. Optionally manage extension behavior

Installation policy and extension behavior policy are separate:

- `ExtensionSettings` installs the extension and controls its update source.
- `HKLM\SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\<privateExtensionId>\policy` supplies the extension's own managed settings.

Review `scripts/Set-ExtensionPolicy.ps1`. It contains this release's private ID and defaults to enforcing `enabled = $true` while permitting a temporary pause (`allowPause = $true`). Confirm the ID against `release-info.json`, then edit `$Policy` before use. Leave settings absent when users should control them. Select your approved work domains before enabling `allowedDomains`; the package does not assume a tenant domain.

| Setting | Effect |
|---|---|
| `enabled = $true` or `$false` | Enforces on/off and locks the popup switch. Force installation alone does not lock this switch. |
| `allowPause = $false` | Prevents the temporary pause. |
| `excludedSites = @('example.com')` | Replaces and locks the exception list; subdomains are included, with at most 100 hosts. Invalid policy entries disable sign-in rules until corrected. |
| `allowedDomains = @('contoso.com')` | Restricts matching account domains and subdomains, and skips domain discovery. Only use organization-approved work domains: this is a trust decision, not verification of an individual account's type. |

For an Intune **Platform script**, use **Run this script using the logged-on credentials: No** and **Run script in 64-bit PowerShell host: Yes**. This writes machine settings under this extension's isolated policy key; it does not install the extension or set local user preferences. The script replaces that extension's managed-settings key, so review all settings you intend to retain. Setting `$Remove = $true` removes only those managed settings.

## 5. Validate the pilot

1. At `edge://policy`, reload policies and confirm `ExtensionSettings` is **OK**, with the expected private ID, HTTPS update URL and `override_update_url`. Check its effective source and any managed behavior settings.
2. At `edge://extensions`, confirm **Use My Profile Account**, the matching private ID and version **1.2.1**, with installation controlled by policy. Check for errors. Do not accept a manually installed unpacked copy as proof of policy deployment.
3. Open the popup in the work profile. Confirm the displayed email is the profile account and **Ready** appears. Test a new supported work sign-in where a different site account hint previously appeared; passwords/MFA/consent must still work.
4. If allowed by policy, test **Pause 15 min**, **Resume now**, and an excluded site. Verify managed controls are locked. Test a profile using a recognized consumer domain and InPrivate behavior: sign-in rules must remain inactive there. The extension does not clear cookies or use content scripts; the session-clearing button opens Microsoft's sign-out page.
5. Remove the previous account-hint extension through its original deployment owner, or remove the unpacked copy manually. Confirm only one account-hint extension remains active in each affected profile. Do not remove unrelated extensions or introduce a broad wildcard policy.
6. Before wider deployment, test an upgrade signed with the same key and a **higher version**, using the HTTPS update route. Confirm the new version installs without changing the private ID. In a permitted test profile, `edge://extensions` → **Developer mode → Update** can trigger a check; normal deployment relies on scheduled checks.

Record join state, Windows/Edge versions, policy source, installed ID/version, sign-in results and update results. Broaden assignment only after the pilot meets your organization's acceptance criteria.

## Release signing and recovery

The private signing key is retained **outside this deployment ZIP** at the release workspace's `.private-release/UseMyProfileAccount.pem`. **Never deploy the PEM**, upload it to the HTTPS host, attach it to Intune, or include it in a source/store ZIP. Restrict access and maintain a protected backup. Reuse that exact key for future CRX releases; losing or replacing it changes the extension ID and requires a managed migration. [Signing and update requirements](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-manage-extensions-webstore).

For each release, increase the source manifest version, rebuild/sign with the retained key, regenerate release metadata and XML, and verify the new CRX. Publish the CRX before advertising its version in the update XML. Keep the ID and hosting policy stable. A lower version is not a normal automatic downgrade: recover with a corrected higher-version release, or temporarily enforce `enabled = $false` to stop sign-in rules while investigating.

To retire the extension, set this exact ID's `installation_mode` to `removed` in the owning `ExtensionSettings` policy, confirm removal on the pilot, and separately remove its managed behavior settings. Remove the obsolete policy entry only after managed devices have received the retirement policy. Removing the ZIP from Intune or deleting the hosted files does not retire an installed extension.

## Optional fallback: hidden Edge Add-ons listing

If private hosting fails your pilot requirements, submit `extension/UseMyProfileAccount.zip` through Partner Center and choose **Hidden** visibility. This removes search/browse discovery; anyone with the listing link can still access it. Store review and approval are required. [Publishing and visibility](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#visibility).

After publication, replace the placeholder ID in `policy/ExtensionSettings.store.json.template` with the assigned **Store ID**, and use the Edge Add-ons update service specified in that template. Apply managed behavior settings under the Store ID as well. Preserve the existing policy JSON and migrate/remove the private or previous extension through its original deployment policy so the two copies do not run together. The private CRX ID and its signing key do not become the Store identity.
