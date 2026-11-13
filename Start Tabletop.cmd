@echo off
setlocal DisableDelayedExpansion
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0portable\launcher.ps1" -Action Start %*
if errorlevel 1 (
  echo.
  if not defined TABLETOP_NO_PAUSE pause
  exit /b 1
)
