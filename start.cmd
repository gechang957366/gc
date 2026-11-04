@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Weekly Paper Digest - LAN server

rem ============================================================
rem  One-click launcher: start the LAN-shared digest page.
rem  Double-click this file. Ctrl+C (or close the window) stops it.
rem ============================================================

cd /d "%~dp0"

rem Portable build ships node.exe next to this file: prefer it.
set "NODE="
if exist "%~dp0node.exe" set "NODE=%~dp0node.exe"
if defined NODE goto node_ready
where node >nul 2>nul
if not errorlevel 1 goto node_from_path
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if defined NODE goto node_ready
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if defined NODE goto node_ready
echo.
echo [ERROR] node.exe not found.
echo Please install Node.js first: https://nodejs.org/
echo.
pause
exit /b 1

:node_from_path
set "NODE=node.exe"

:node_ready
if not exist "%~dp0scripts\lan-server.mjs" (
  echo [ERROR] scripts\lan-server.mjs missing - is this folder complete?
  pause
  exit /b 1
)

"%NODE%" "%~dp0scripts\lan-server.mjs" %*
set "CODE=%ERRORLEVEL%"

if not "%CODE%"=="0" (
  echo.
  echo [EXIT] launcher stopped with code %CODE%.
  pause
)
endlocal
