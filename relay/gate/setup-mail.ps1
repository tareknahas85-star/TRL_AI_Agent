# setup-mail.ps1 - run it yourself. Creates MAIL_KEY (write-only for the mailbox), deploys the gate.
# The key is never printed; it is copied to the clipboard for the Apps Script property.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$key = (($b | ForEach-Object { $_.ToString('x2') }) -join '')
$tmp = Join-Path $env:TEMP ('m-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  [IO.File]::WriteAllText($tmp, ([ordered]@{ MAIL_KEY = $key } | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
  npx wrangler secret bulk $tmp
  if ($LASTEXITCODE -ne 0) { throw 'wrangler secret bulk failed' }
} finally { if (Test-Path $tmp) { Remove-Item $tmp -Force } }
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { throw 'wrangler deploy failed' }
Set-Clipboard -Value $key
Write-Host 'Done. MAIL_KEY is on your clipboard: paste it into Apps Script > Project Settings > Script properties (MAIL_KEY), then run: Set-Clipboard -Value $null'
