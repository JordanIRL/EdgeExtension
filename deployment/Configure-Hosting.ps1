#Requires -Version 5.1
<#
.SYNOPSIS
  Generates the update manifest and Edge installation policy for this private release.
.DESCRIPTION
  Run from an extracted deployment package with the HTTPS directory URL supplied by your
  hosting team. Verifies release-info.json and extension/UseMyProfileAccount.crx offline,
  then writes hosting/updates.xml and policy/ExtensionSettings.private.json.
  Upload updates.xml and the CRX to that directory, and deploy the generated policy separately.
  This script does not contact the host, change registry settings, or access a tenant.
.PARAMETER BaseUrl
  HTTPS directory URL where updates.xml and UseMyProfileAccount.crx will be published.
  Query strings, fragments, user information, whitespace, and backslashes are not accepted.
.PARAMETER PackageRoot
  Extracted package directory containing release-info.json, extension/, hosting/, and policy/.
  Defaults to the parent of this script's directory in the deployment package.
.EXAMPLE
  .\scripts\Configure-Hosting.ps1 -BaseUrl (Read-Host 'HTTPS hosting directory URL') -WhatIf
  Validates the package and previews the write operation without creating or changing files.
.OUTPUTS
  System.String. Generated file paths and the corresponding publication URLs.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,
  [string]$PackageRoot = (Split-Path -Parent $PSScriptRoot)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
  $baseUri = $null
  if ($BaseUrl -notmatch '^https://' -or $BaseUrl -match '[\\\s?#]' -or
      $BaseUrl -match '^https://[^/]*@' -or
      -not [Uri]::TryCreate($BaseUrl, [UriKind]::Absolute, [ref]$baseUri) -or
      $baseUri.Scheme -ne 'https' -or [string]::IsNullOrEmpty($baseUri.Host) -or
      $baseUri.Query -or $baseUri.Fragment -or $baseUri.UserInfo) {
    throw 'BaseUrl must be a clean HTTPS directory URL with no query, fragment, user information, whitespace, or backslashes.'
  }
  $base = $baseUri.AbsoluteUri.TrimEnd('/')
  $codebase = "$base/UseMyProfileAccount.crx"
  $updateUrl = "$base/updates.xml"

  $resolvedRoot = Resolve-Path -LiteralPath $PackageRoot
  if ($resolvedRoot.Provider.Name -ne 'FileSystem' -or
      -not (Test-Path -LiteralPath $resolvedRoot.ProviderPath -PathType Container)) {
    throw 'PackageRoot must be an existing extracted package directory on the file system.'
  }
  $root = $resolvedRoot.ProviderPath
  $infoPath = Join-Path $root 'release-info.json'
  if (-not (Test-Path -LiteralPath $infoPath -PathType Leaf)) {
    throw "Missing $infoPath. Extract the complete deployment package before running this script."
  }
  $info = Get-Content -LiteralPath $infoPath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($name in @('version', 'privateExtensionId', 'crxSha256', 'privateCrxFileName')) {
    $property = $info.PSObject.Properties[$name]
    if ($null -eq $property -or $property.Value -isnot [string] -or
        [string]::IsNullOrWhiteSpace($property.Value)) {
      throw "release-info.json must contain a nonempty string property named '$name'."
    }
  }
  $version = $info.version
  if ($version -cnotmatch '^(0|[1-9][0-9]{0,4})(\.(0|[1-9][0-9]{0,4})){0,3}$') {
    throw 'The release version must contain one to four integer components, without leading zeroes.'
  }
  $versionParts = @($version.Split('.') | ForEach-Object { [int]$_ })
  if (@($versionParts | Where-Object { $_ -gt 65535 }).Count -gt 0 -or
      @($versionParts | Where-Object { $_ -gt 0 }).Count -eq 0) {
    throw 'Release version components must be between 0 and 65535, and the version cannot be all zeroes.'
  }
  $extensionId = $info.privateExtensionId
  if ($extensionId -cnotmatch '^[a-p]{32}$') {
    throw 'privateExtensionId must be the actual 32-letter lowercase private extension ID (letters a through p).'
  }
  if ($info.privateCrxFileName -cne 'UseMyProfileAccount.crx') {
    throw 'privateCrxFileName must be UseMyProfileAccount.crx for this deployment package.'
  }
  if ($info.crxSha256 -cnotmatch '^[0-9a-fA-F]{64}$') {
    throw 'crxSha256 must be the 64-character SHA-256 digest of the private CRX.'
  }
  $crxPath = Join-Path (Join-Path $root 'extension') $info.privateCrxFileName
  if (-not (Test-Path -LiteralPath $crxPath -PathType Leaf)) {
    throw "Missing $crxPath. Extract the complete deployment package before running this script."
  }
  $actualSha256 = (Get-FileHash -LiteralPath $crxPath -Algorithm SHA256).Hash
  if ($actualSha256 -ine $info.crxSha256) {
    throw 'The CRX SHA-256 does not match release-info.json. Use an intact deployment package; do not update the digest to bypass this check.'
  }
  $stream = [IO.File]::OpenRead($crxPath)
  try {
    if ($stream.Length -lt 16) { throw 'The CRX is too short to contain a CRX3 header and extension archive.' }
    $reader = [IO.BinaryReader]::new($stream)
    if ([Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -cne 'Cr24' -or
        $reader.ReadUInt32() -ne 3) {
      throw 'The private extension file must use the CRX3 format (Cr24 magic and format version 3).'
    }
    $headerLength = $reader.ReadUInt32()
    if ($headerLength -eq 0 -or (12 + [long]$headerLength + 4) -gt $stream.Length) {
      throw 'The CRX3 header length is invalid or its extension archive is missing.'
    }
    $stream.Position = 12 + [long]$headerLength
    if ([BitConverter]::ToString($reader.ReadBytes(4)) -ne '50-4B-03-04') {
      throw 'The CRX3 payload does not start with a ZIP extension archive. Use the original signed release file.'
    }
  } finally {
    $stream.Dispose()
  }

  $hostingDir = Join-Path $root 'hosting'
  $policyDir = Join-Path $root 'policy'
  $xmlPath = Join-Path $hostingDir 'updates.xml'
  $policyPath = Join-Path $policyDir 'ExtensionSettings.private.json'
  foreach ($directory in @($hostingDir, $policyDir)) {
    if ((Test-Path -LiteralPath $directory) -and
        -not (Test-Path -LiteralPath $directory -PathType Container)) {
      throw "An output directory is occupied by a file: $directory. Move that file before running this script."
    }
  }
  foreach ($output in @($xmlPath, $policyPath)) {
    if (Test-Path -LiteralPath $output -PathType Container) {
      throw "An output file path is occupied by a directory: $output. Move that directory before running this script."
    }
  }

  $utf8 = [Text.UTF8Encoding]::new($false)
  $xmlSettings = [Xml.XmlWriterSettings]::new()
  $xmlSettings.Encoding = $utf8
  $xmlSettings.Indent = $true
  $xmlSettings.NewLineChars = "`r`n"
  $xmlStream = [IO.MemoryStream]::new()
  try {
    $writer = [Xml.XmlWriter]::Create($xmlStream, $xmlSettings)
    try {
      $namespace = 'http://www.google.com/update2/response'
      $writer.WriteStartDocument()
      $writer.WriteStartElement('gupdate', $namespace)
      $writer.WriteAttributeString('protocol', '2.0')
      $writer.WriteStartElement('app', $namespace)
      $writer.WriteAttributeString('appid', $extensionId)
      $writer.WriteStartElement('updatecheck', $namespace)
      $writer.WriteAttributeString('codebase', $codebase)
      $writer.WriteAttributeString('version', $version)
      $writer.WriteEndElement()
      $writer.WriteEndElement()
      $writer.WriteEndElement()
      $writer.WriteEndDocument()
      $writer.Flush()
      $xmlBytes = $xmlStream.ToArray()
    } finally {
      $writer.Dispose()
    }
  } finally {
    $xmlStream.Dispose()
  }
  $policy = @{}
  $policy[$extensionId] = [ordered]@{
    installation_mode = 'force_installed'
    update_url = $updateUrl
    override_update_url = $true
    minimum_version_required = $version
  }
  $policyJson = $policy | ConvertTo-Json -Depth 4

  if ($PSCmdlet.ShouldProcess($root, "Write hosting/updates.xml and policy/ExtensionSettings.private.json for private extension $extensionId version $version")) {
    [IO.Directory]::CreateDirectory($hostingDir) | Out-Null
    [IO.Directory]::CreateDirectory($policyDir) | Out-Null
    [IO.File]::WriteAllBytes($xmlPath, $xmlBytes)
    [IO.File]::WriteAllText($policyPath, $policyJson + "`r`n", $utf8)
    Write-Output "Generated update manifest: $xmlPath"
    Write-Output "Generated Edge ExtensionSettings policy: $policyPath"
    Write-Output "Publish $crxPath at $codebase"
    Write-Output "Publish $xmlPath at $updateUrl"
  } else {
    Write-Output 'Package validated. No files were written.'
    Write-Output "CRX publication URL: $codebase"
    Write-Output "Update manifest URL: $updateUrl"
  }
} catch {
  throw "Configure-Hosting failed: $($_.Exception.Message) Correct the input or package contents and run the script again."
}
