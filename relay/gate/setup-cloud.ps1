# setup-cloud.ps1 - run it yourself. Secrets are typed hidden and never printed.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$repo    = 'YOUR-GITHUB-USER/trl-agent-runner'
$gateUrl = 'https://trl-agent-gate.YOUR-SUBDOMAIN.workers.dev'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'gh CLI not found. Install it: winget install GitHub.cli' }
gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Run: gh auth login' }

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

$tgToken = Read-Hidden 'Telegram bot token'
$chatId  = (Read-Host 'Telegram chat id (numbers only)').Trim()
$orKey   = Read-Hidden 'OpenRouter API key'
$ghPat   = Read-Hidden 'GitHub fine-grained PAT (Actions: read/write on trl-agent-runner)'
if (-not $tgToken -or -not $chatId -or -not $orKey -or -not $ghPat) { throw 'Empty value, aborting.' }
if ($chatId -notmatch '^-?\d+$') { throw 'Chat id must be numeric.' }

$webhookPath   = New-Secret
$webhookSecret = New-Secret
$gateKey       = New-Secret

$tmp1 = Join-Path $env:TEMP ('w-' + [guid]::NewGuid().ToString('N') + '.json')
$tmp2 = Join-Path $env:TEMP ('r-' + [guid]::NewGuid().ToString('N') + '.env')
$utf8 = New-Object Text.UTF8Encoding $false
try {
  # 1) Worker secrets (bulk file keeps values exact, no stray newline)
  $workerSecrets = [ordered]@{
    TG_TOKEN       = $tgToken
    TG_CHAT_ID     = $chatId
    WEBHOOK_PATH   = $webhookPath
    WEBHOOK_SECRET = $webhookSecret
    GATE_KEY       = $gateKey
    GH_TOKEN       = $ghPat
  }
  [IO.File]::WriteAllText($tmp1, ($workerSecrets | ConvertTo-Json), $utf8)
  Write-Host 'Setting Worker secrets...'
  npx wrangler secret bulk $tmp1
  if ($LASTEXITCODE -ne 0) { throw 'wrangler secret bulk failed' }

  # 2) Runner repo secrets
  $env = "TG_TOKEN=$tgToken`nTG_CHAT_ID=$chatId`nOPENROUTER_KEY=$orKey`nGATE_URL=$gateUrl`nGATE_KEY=$gateKey`n"
  [IO.File]::WriteAllText($tmp2, $env, $utf8)
  Write-Host 'Setting runner repo secrets...'
  gh secret set --env-file $tmp2 --repo $repo
  if ($LASTEXITCODE -ne 0) { throw 'gh secret set failed' }
}
finally {
  foreach ($f in @($tmp1, $tmp2)) { if (Test-Path $f) { Remove-Item $f -Force } }
}

# 3) The app needs GATE_KEY too: put it on the clipboard, never on screen
Set-Clipboard -Value $gateKey
Write-Host ''
Write-Host 'Done. GATE_KEY is on your clipboard (the app needs it).'
Write-Host 'Paste it where the app asks for it, then run: Set-Clipboard -Value $null'
Write-Host 'Webhook was NOT set yet (it would stop the app from receiving messages).'