# rotate-gate-key.ps1 - run it yourself. The key is never printed, only copied to the clipboard.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'gh CLI not found.' }
gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Run: gh auth login' }

$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$gateKey = (($b | ForEach-Object { $_.ToString('x2') }) -join '')

$tmp1 = Join-Path $env:TEMP ('g-' + [guid]::NewGuid().ToString('N') + '.json')
$tmp2 = Join-Path $env:TEMP ('g-' + [guid]::NewGuid().ToString('N') + '.env')
$utf8 = New-Object Text.UTF8Encoding $false
try {
  [IO.File]::WriteAllText($tmp1, ([ordered]@{ GATE_KEY = $gateKey } | ConvertTo-Json), $utf8)
  npx wrangler secret bulk $tmp1
  if ($LASTEXITCODE -ne 0) { throw 'wrangler secret bulk failed' }

  [IO.File]::WriteAllText($tmp2, "GATE_KEY=$gateKey`n", $utf8)
  gh secret set --env-file $tmp2 --repo $repo
  if ($LASTEXITCODE -ne 0) { throw 'gh secret set failed' }
}
finally {
  foreach ($f in @($tmp1, $tmp2)) { if (Test-Path $f) { Remove-Item $f -Force } }
}

Set-Clipboard -Value $gateKey
Write-Host 'Done. The new GATE_KEY is on your clipboard. Paste it in the app now (Agents tab).'