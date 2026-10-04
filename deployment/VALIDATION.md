# Package validation — 4 October 2026

Release: Use My Profile Account 1.2.1. Private extension ID: `lbohpojbnjhjpobcgkknhccfmahnfplp`.

## Completed checks

- Microsoft Edge 154 created the CRX3 package. Its cryptographic signature was independently verified against the signed header and ZIP bytes; the public-key hash matches the private extension ID. The retained PEM matches that public key.
- All 19 runtime files inside the CRX match the tested source ZIP byte for byte. Manifest, schema, JavaScript imports, HTML resources and icons resolve within the runtime package.
- Runtime validation passed 1,411 rule assertions, worker lifecycle tests, settings/UI tests and static checks. Native Edge accepted the default rules, the 60-character excluded-host fixture and 100 excluded sites; ten native rule-matching cases passed. Popup and settings interactions were checked in isolated Edge profiles with example accounts.
- The offline hosting helper passed 45 assertions in PowerShell 7.4.20: real package checks, default and explicit package paths, `-WhatIf`, XML/JSON content and escaping, UTF-8 output, malformed URLs/metadata and tampered CRX rejection. Rejected input leaves previous output files unchanged.
- Both PowerShell deployment scripts passed syntax parsing. The behavior-policy script was not executed against a Windows registry.
- Private extension ID, version, policy settings and update XML agree across release metadata, templates and scripts. The ZIP excludes the signing PEM, developer profile files and unrelated repository files.

## Checks required in your environment

Configure the actual HTTPS location and verify downloaded XML/CRX content and headers. Test policy installation, sign-in behavior and a subsequent higher-version update on a pilot for each device join type and Edge channel you intend to use. Microsoft documentation currently differs on Entra-only self-hosting eligibility; see README.md for the current policy reference and older guidance.

The generator targets PowerShell 5.1-compatible syntax but was executed with PowerShell 7.4.20 on macOS. Windows PowerShell 5.1, Intune policy assignment, Microsoft 365 policy assignment, hosting availability and live work-account authentication have not been verified by this package build.

SHA256SUMS.txt records the hashes of the delivered files. It detects accidental changes; it is not a tenant execution or approval record.
