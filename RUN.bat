@echo off
REM Double-click or: RUN.bat
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "run.ps1" %*
if errorlevel 1 pause
