#Requires -Version 5.1
<#
.SYNOPSIS
  Build ONE Kramcop.exe (API + web UI inside). Opens browser on double-click.

.EXAMPLE
  .\scripts\build_kramcop_web_exe.ps1
  .\scripts\build_kramcop_web_exe.ps1 -SkipWeb
#>
param([switch]$SkipWeb)
$ErrorActionPreference = "Stop"
& "$PSScriptRoot\build_product_web_exe.ps1" -Product kramcop -SkipWeb:$SkipWeb
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
