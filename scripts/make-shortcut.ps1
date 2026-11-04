# 在桌面创建"每周文献速递"快捷方式（双击即启动内网共享）
#
#   powershell -ExecutionPolicy Bypass -File scripts\make-shortcut.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\make-shortcut.ps1 -Remove

param(
  [switch]$Remove,
  [string]$Name = '每周文献速递'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Target = Join-Path $Root 'start.cmd'
$Desktop = [Environment]::GetFolderPath('Desktop')
$LinkPath = Join-Path $Desktop ($Name + '.lnk')

if ($Remove) {
  if (Test-Path $LinkPath) {
    Remove-Item $LinkPath -Force
    Write-Host "已删除桌面快捷方式：$LinkPath"
  } else {
    Write-Host '桌面上没有这个快捷方式'
  }
  exit 0
}

if (-not (Test-Path $Target)) { throw "找不到启动脚本：$Target" }

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($LinkPath)
$link.TargetPath = $Target
$link.WorkingDirectory = $Root
$link.Description = '每周文献速递 · 一键启动内网共享'
$link.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
$link.Save()

Write-Host "已创建桌面快捷方式：$LinkPath"
Write-Host "双击它即可启动；启动后浏览器会自动打开 http://127.0.0.1:8099/"
