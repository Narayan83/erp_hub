@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_kramcop_web_exe.ps1" %*
