# setup-fcm.ps1 - run it yourself. Stores the Firebase service-account key on the gate as the secret FCM_SA (never printed).
# Usage: .\setup-fcm.ps1 -KeyFile "C:\path\to\your-firebase-adminsdk.json"
param([Parameter(Mandatory = $true)][string]$KeyFile)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path $KeyFile)) { throw "File not found: $KeyFile" }
$j = Get-Content $KeyFile -Raw | ConvertFrom-Json
if (-not $j.private_key -or -not $j.client_email -or -not $j.project_id) { throw 'This is not a Firebase service-account key file.' }
$tmp = Join-Path $env:TEMP ('f-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  $sa = ($j | ConvertTo-Json -Compress -Depth 5)
  [IO.File]::WriteAllText($tmp, (@{ FCM_SA = $sa } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
  npx wrangler secret bulk $tmp
  if ($LASTEXITCODE -ne 0) { throw 'wrangler secret bulk failed' }
} finally { if (Test-Path $tmp) { Remove-Item $tmp -Force } }
Write-Host "Done. FCM_SA is set for project $($j.project_id). Delete the key file from your Downloads now."
