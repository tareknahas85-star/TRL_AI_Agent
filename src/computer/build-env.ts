// PowerShell prelude injected before every pc_run command. It makes build tooling "just work" on this machine:
// finds a JDK and the Android SDK, and provides __gw, a smart gradlew that falls back to the Gradle already
// downloaded on the machine when the project has no wrapper (and steps into a nested Gradle project folder).
export const BUILD_ENV_PS = String.raw`
$ErrorActionPreference='Continue'
$u=$env:USERPROFILE
function __fixenv {
$u=$env:USERPROFILE
if(-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME 'bin\javac.exe'))){
  $j=$null
  foreach($d in (Get-ChildItem -Path $u -Directory -Filter 'jdk*' -ErrorAction SilentlyContinue | Sort-Object Name)){
    $c=Get-ChildItem -Path $d.FullName -Directory -Filter 'jdk-*' -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName 'bin\javac.exe') } | Select-Object -First 1
    if($c){ $j=$c.FullName; break }
    if(Test-Path (Join-Path $d.FullName 'bin\javac.exe')){ $j=$d.FullName; break }
  }
  if($j){ $env:JAVA_HOME=$j }
}
if($env:JAVA_HOME){ $env:Path=(Join-Path $env:JAVA_HOME 'bin')+';'+$env:Path }
if(-not $env:ANDROID_HOME -or -not (Test-Path $env:ANDROID_HOME)){
  foreach($c in @((Join-Path $u 'android-sdk'),(Join-Path $env:LOCALAPPDATA 'Android\Sdk'))){ if(Test-Path $c){ $env:ANDROID_HOME=$c; break } }
}
if($env:ANDROID_HOME){ $env:ANDROID_SDK_ROOT=$env:ANDROID_HOME }
}
__fixenv
$script:GBAT=$null
$gb=Get-ChildItem (Join-Path $u '.gradle\wrapper\dists') -Recurse -Filter gradle.bat -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if($gb){ $script:GBAT=$gb.FullName }
function __gw {
  __fixenv
  if(-not (Test-Path 'settings.gradle*')){
    $d=Get-ChildItem -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName 'settings.gradle*') } | Select-Object -First 1
    if($d){ Set-Location $d.FullName }
  }
  if(Test-Path '.\gradlew.bat'){ & '.\gradlew.bat' @args --console=plain --no-daemon }
  elseif($script:GBAT){ & $script:GBAT @args --console=plain --no-daemon }
  else { Write-Output 'Error: no gradlew.bat in the project and no Gradle installed on this machine' }
}
`
