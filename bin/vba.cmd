@echo off
if exist "%~dp0\..\vendor\node.exe" (
  "%~dp0\..\vendor\node.exe" --no-warnings "%~dp0\..\lib\vbapm.js" %*
) else (
  node --no-warnings "%~dp0\..\lib\vbapm.js" %*
)
