# 注册 / 卸载「每周自动更新」计划任务（Windows 计划任务）
#
#   powershell -ExecutionPolicy Bypass -File scripts\schedule-weekly.ps1            # 安装（每周一 08:00）
#   powershell -ExecutionPolicy Bypass -File scripts\schedule-weekly.ps1 -Uninstall # 卸载
#   ... -Time 09:30 -Day WED                                                       # 自定义时间/星期
#
# 任务动作：用 node 跑 scripts\update-weekly.mjs（抓新文献 → DeepSeek 整理 → 写新期号 → 重建独立版）。
# 不需要 DeepSeek Harness 在跑，也不需要在对话里输入任何指令。

param(
  [string]$TaskName = 'DSH Weekly Paper Digest',
  [string]$Time = '08:00',
  [ValidateSet('MON','TUE','WED','THU','FRI','SAT','SUN')]
  [string]$Day = 'MON',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Script = Join-Path $Root 'scripts\update-weekly.mjs'

if ($Uninstall) {
  schtasks /delete /tn $TaskName /f | Out-Null
  Write-Host "已卸载计划任务：$TaskName"
  exit 0
}

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) {
  $candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
  )
  $Node = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Node) { throw 'node.exe 没找到，请先安装 Node.js 或改这里的路径' }
if (-not (Test-Path $Script)) { throw "找不到更新脚本：$Script" }

$action = "`"$Node`" `"$Script`""

schtasks /create /tn $TaskName /tr $action /sc weekly /d $Day /st $Time /f | Out-Null
Write-Host "已注册计划任务：$TaskName"
Write-Host "  动作：$action"
Write-Host "  频率：每周 $Day $Time"
Write-Host ''
Write-Host "查看：schtasks /query /tn `"$TaskName`" /v /fo list"
Write-Host "立即跑一次：schtasks /run /tn `"$TaskName`""
Write-Host '日志：data\logs\update-YYYY-MM-DD.log'
