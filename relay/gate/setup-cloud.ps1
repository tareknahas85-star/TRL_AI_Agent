# setup-cloud.ps1 - run it yourself. Secrets are typed hidden and never printed.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'common.ps1')

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

Write-Host 'Required: a GitHub token, and at least one model key (Gemini or OpenRouter). Telegram is optional - press Enter to skip it.'
$ghPat    = Read-Hidden 'GitHub fine-grained PAT (Actions: read/write on this repo)'
$gemKey   = Read-Hidden 'Gemini API key (recommended; Enter to skip)'
$orKey    = Read-Hidden 'OpenRouter API key (optional fallback; Enter to skip)'
$tgToken  = Read-Hidden 'Telegram bot token (optional; Enter to skip)'
$chatId   = ''
if ($tgToken) { $chatId = (Read-Host 'Telegram chat id (numbers only)').Trim() }
if (-not $ghPat) { throw 'GitHub token is required, aborting.' }
if (-not $gemKey -and -not $orKey) { throw 'Give at least one model key (Gemini or OpenRouter), aborting.' }
if ($tgToken -and -not $chatId) { throw 'Telegram token needs its chat id, aborting.' }
if ($chatId -and $chatId -notmatch '^-?\d+$') { throw 'Chat id must be numeric.' }

$webhookPath   = New-Secret
$webhookSecret = New-Secret
$gateKey       = New-Secret

$tmp1 = Join-Path $env:TEMP ('w-' + [guid]::NewGuid().ToString('N') + '.json')
$tmp2 = Join-Path $env:TEMP ('r-' + [guid]::NewGuid().ToString('N') + '.env')
$utf8 = New-Object Text.UTF8Encoding $false
try {
  # 1) Worker secrets (bulk file keeps values exact, no stray newline)
  $workerSecrets = [ordered]@{
    WEBHOOK_PATH   = $webhookPath
    WEBHOOK_SECRET = $webhookSecret
    GATE_KEY       = $gateKey
    GH_TOKEN       = $ghPat
  }
  if ($tgToken) { $workerSecrets['TG_TOKEN'] = $tgToken; $workerSecrets['TG_CHAT_ID'] = $chatId }
  [IO.File]::WriteAllText($tmp1, ($workerSecrets | ConvertTo-Json), $utf8)
  Write-Host 'Setting Worker secrets...'
  npx wrangler secret bulk $tmp1
  if ($LASTEXITCODE -ne 0) { throw 'wrangler secret bulk failed' }

  # 2) Runner repo secrets
  $runnerEnv = "GATE_URL=$gateUrl`nGATE_KEY=$gateKey`n"
  if ($gemKey)  { $runnerEnv += "GEMINI_KEY=$gemKey`n" }
  if ($orKey)   { $runnerEnv += "OPENROUTER_KEY=$orKey`n" }
  if ($tgToken) { $runnerEnv += "TG_TOKEN=$tgToken`nTG_CHAT_ID=$chatId`n" }
  [IO.File]::WriteAllText($tmp2, $runnerEnv, $utf8)
  Write-Host 'Setting runner repo secrets...'
  gh secret set --env-file $tmp2 --repo $repo
  if ($LASTEXITCODE -ne 0) { throw 'gh secret set failed' }

  # 3) Deploy the Worker, pointing it at this repo
  Write-Host 'Deploying Worker...'
  npx wrangler deploy --var "GH_REPO:$repo"
  if ($LASTEXITCODE -ne 0) { throw 'wrangler deploy failed' }
}
finally {
  foreach ($f in @($tmp1, $tmp2)) { if (Test-Path $f) { Remove-Item $f -Force } }
}

# 4) The app needs GATE_KEY too: put it on the clipboard, never on screen
Set-Clipboard -Value $gateKey
Write-Host ''
Write-Host 'Done. GATE_KEY is on your clipboard (the app needs it).'
Write-Host 'Paste it where the app asks for it, then run: Set-Clipboard -Value $null'
if ($tgToken) { Write-Host 'Telegram: run webhook.ps1 on only if you want to control agents from Telegram (it stops the app from polling the gate).' }
Write-Host 'Next: open the app > Agents tab and enter your Worker URL and this key.'