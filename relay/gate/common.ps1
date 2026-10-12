# common.ps1 - shared settings, dot-sourced by the other scripts.
# $repo    : GitHub "owner/name" of THIS repository (read from the git remote, or set $env:TRL_REPO)
# $gateUrl : your Worker URL (set $env:TRL_GATE_URL, or you are asked once)
$repo = $env:TRL_REPO
if (-not $repo) {
  $remote = (git -C $PSScriptRoot config --get remote.origin.url) 2>$null
  if ($remote -match 'github\.com[:/]([^/]+/[^/.]+?)(\.git)?$') { $repo = $Matches[1] }
}
if (-not $repo) { throw 'Cannot detect the GitHub repo. Run this from a git clone, or set $env:TRL_REPO = "owner/name".' }
$gateUrl = $env:TRL_GATE_URL
if (-not $gateUrl) { $gateUrl = (Read-Host 'Worker URL (https://trl-agent-gate.<your-subdomain>.workers.dev)').Trim().TrimEnd('/') }
if ($gateUrl -notmatch '^https://') { throw 'Worker URL must start with https://' }
