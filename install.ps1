# ZININ CLI — установщик для Windows. Без Node, без Homebrew.
#   irm https://zinin.ai/install.ps1 | iex
$ErrorActionPreference = "Stop"

$repo = "TimmyZinin/zinin-cli"
$dest = "$env:LOCALAPPDATA\zinin"
$bin  = "$dest\zinin.exe"
$url  = "https://github.com/$repo/releases/latest/download/zinin-windows-x64.exe"

Write-Host "`n  Ставлю ZININ (windows-x64)…"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Invoke-WebRequest -Uri $url -OutFile $bin

# добавить в PATH пользователя, если ещё нет
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$dest*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$dest", "User")
  Write-Host "  Добавил $dest в PATH (новый терминал подхватит)."
}

Write-Host "`n  Готово. Запусти: zinin"
Write-Host "  (если «команда не найдена» — открой новый PowerShell)`n"
