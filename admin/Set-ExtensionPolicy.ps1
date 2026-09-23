<#
.SYNOPSIS
  Enforces "Use My Profile Account" settings for every Edge profile on this device.

.DESCRIPTION
  Writes Edge extension policy to
  HKLM:\SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\<ExtensionId>\policy
  Edit $ExtensionId and $Policy below, then deploy it. With Intune, use Devices > Scripts and
  remediations > Platform scripts and set "Run this script using the logged on credentials" to No,
  because HKLM needs SYSTEM or an administrator.
  Leave a setting commented out to let users choose it themselves.
  Edge picks up changes within about 15 minutes, or straight away from edge://policy > Reload policies.
#>

# The ID shown on edge://extensions (Edge Add-ons assigns a different ID from an unpacked copy).
$ExtensionId = 'REPLACE_WITH_EXTENSION_ID'

# Set to $true to delete the policy instead (Intune platform scripts can't take parameters).
$Remove = $false

$Policy = [ordered]@{
  # enabled         = $true
  # hintMode        = 'missing'          # 'missing' (keep a site's choice) or 'always'
  # accountPicker   = 'skip'             # 'skip' (sign straight in) or 'site' (show the picker)
  # includeFrames   = $true
  # allowPause      = $true
  # excludedSites   = @('dev.azure.com')
  # allowedDomains  = @('contoso.com')   # only act for accounts in these domains
}

$ErrorActionPreference = 'Stop'
if ($ExtensionId -cnotmatch '^[a-p]{32}$') { throw "Set `$ExtensionId to the 32-letter, lower-case extension ID first." }
$key = "HKLM:\SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\$ExtensionId\policy"

# Start clean so settings removed from $Policy don't linger.
if (Test-Path $key) { Remove-Item $key -Recurse -Force }
if ($Remove) { Write-Output "Removed $key"; return }
New-Item -Path $key -Force | Out-Null

foreach ($name in $Policy.Keys) {
  $value = $Policy[$name]
  if ($name -in 'excludedSites', 'allowedDomains') { $value = @($value) }  # a single string still has to be a list
  if ($value -is [bool]) {
    New-ItemProperty -Path $key -Name $name -PropertyType DWord -Value ([int]$value) -Force | Out-Null
  } elseif ($value -is [array]) {
    # Lists are a subkey with values named 1, 2, 3...
    $list = New-Item -Path (Join-Path $key $name) -Force
    $i = 1
    foreach ($item in $value) { New-ItemProperty -Path $list.PSPath -Name "$i" -PropertyType String -Value $item -Force | Out-Null; $i++ }
  } else {
    New-ItemProperty -Path $key -Name $name -PropertyType String -Value $value -Force | Out-Null
  }
}
Write-Output "Wrote $($Policy.Count) setting(s) to $key"
