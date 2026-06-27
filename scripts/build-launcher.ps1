$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'tools\launcher\AiChatLauncher.cs'
$output = Join-Path $root 'AiChat.exe'
$icon = Join-Path $root 'assets\app-icon.ico'
$candidates = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)

$csc = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) {
  throw 'Could not find .NET Framework csc.exe.'
}

if (-not (Test-Path -LiteralPath $source)) {
  throw "Launcher source not found: $source"
}

if (-not (Test-Path -LiteralPath $icon)) {
  throw "Launcher icon not found: $icon"
}

& $csc /nologo /target:winexe /platform:anycpu /optimize+ /win32icon:$icon /out:$output /reference:System.Windows.Forms.dll $source

Write-Host "Launcher built: $output"
