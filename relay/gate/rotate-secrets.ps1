# rotate-secrets.ps1 - run it yourself. Values are typed hidden; press Enter to skip one.
# Create the NEW keys first (BotFather /revoke, openrouter.ai/keys, GitHub PAT), then paste each here.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'common.ps1')
function Read-Hidden($prompt) {
  $s = Read-Host $prompt -AsSecureString
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}
function Set-Worker($name, $value) {
  $t = Join-Path $env:TEMP ('r-' + [guid]::NewGuid().ToString('N') + '.json')
  try {
    [IO.File]::WriteAllText($t, ([ordered]@{ $name = $value } | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
    npx wrangler secret bulk $t
    if ($LASTEXITCODE -ne 0) { throw "wrangler secret $name failed" }
  } finally { if (Test-Path $t) { Remove-Item $t -Force } }
}
function Set-Repo($name, $value) {
  $t = Join-Path $env:TEMP ('r-' + [guid]::NewGuid().ToString('N') + '.env')
  try {
    [IO.File]::WriteAllText($t, "$name=$value`n", (New-Object Text.UTF8Encoding $false))
    gh secret set --env-file $t --repo $repo
    if ($LASTEXITCODE -ne 0) { throw "gh secret $name failed" }
  } finally { if (Test-Path $t) { Remove-Item $t -Force } }
}
$tg = Read-Hidden 'NEW Telegram bot token (Enter = skip)'
if ($tg) { Set-Worker 'TG_TOKEN' $tg; Set-Repo 'TG_TOKEN' $tg; Write-Host 'TG_TOKEN updated (Worker + runner).' }
$or = Read-Hidden 'NEW OpenRouter key (Enter = skip)'
if ($or) { Set-Repo 'OPENROUTER_KEY' $or; Write-Host 'OPENROUTER_KEY updated (runner).' }
$gh = Read-Hidden 'NEW GitHub PAT for dispatch (Enter = skip)'
if ($gh) { Set-Worker 'GH_TOKEN' $gh; Write-Host 'GH_TOKEN updated (Worker).' }
$tg = $null; $or = $null; $gh = $null
Write-Host 'Next: put the new Telegram token + OpenRouter key in the app too, then run .\webhook.ps1 on'
