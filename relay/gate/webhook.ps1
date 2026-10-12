# webhook.ps1 on|off - run it yourself. Token typed hidden.
param([Parameter(Mandatory)][ValidateSet('on','off')][string]$Mode)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'common.ps1')

function New-Secret {
  $b = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}
function Read-Hidden($prompt) {
  $s = Read-Host $prompt -AsSecureString
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}
function Tg($token, $method, $body) {
  try {
    if ($body) {
      Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/$method" `
        -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 5)
    } else {
      Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/$method"
    }
  } catch { throw "Telegram call '$method' failed (HTTP $($_.Exception.Response.StatusCode.value__))" }
}

$tg = Read-Hidden 'Telegram bot token'
if (-not $tg) { throw 'Empty token.' }

if ($Mode -eq 'off') {
  $r = Tg $tg 'deleteWebhook' $null
  Write-Host "Webhook removed: ok=$($r.ok). The app gets Telegram messages again."
  return
}

$path   = New-Secret
$secret = New-Secret
$tmp = Join-Path $env:TEMP ('w-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  $json = [ordered]@{ WEBHOOK_PATH = $path; WEBHOOK_SECRET = $secret; TG_TOKEN = $tg } | ConvertTo-Json
  [IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding $false))
  npx wrangler secret bulk $tmp
  if ($LASTEXITCODE -ne 0) { throw 'wrangler secret bulk failed' }
} finally { if (Test-Path $tmp) { Remove-Item $tmp -Force } }

# keep the runner's copy of the token in sync too
$envf = Join-Path $env:TEMP ('t-' + [guid]::NewGuid().ToString('N') + '.env')
try {
  [IO.File]::WriteAllText($envf, "TG_TOKEN=$tg`n", (New-Object Text.UTF8Encoding $false))
  gh secret set --env-file $envf --repo $repo
  if ($LASTEXITCODE -ne 0) { throw 'gh secret set failed' }
} finally { if (Test-Path $envf) { Remove-Item $envf -Force } }

$r = Tg $tg 'setWebhook' @{
  url             = "$gateUrl/tg/$path"
  secret_token    = $secret
  allowed_updates = @('message', 'callback_query')
}
$i = (Tg $tg 'getWebhookInfo' $null).result
Write-Host "setWebhook ok=$($r.ok) | webhook set=$([bool]$i.url) | pending=$($i.pending_update_count) | last error='$($i.last_error_message)'"
Write-Host 'REMEMBER: run  .\webhook.ps1 off  when you finish testing.'