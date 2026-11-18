#Requires -Version 5.1
param([switch]$SkipWeb)
$ErrorActionPreference = "Stop"
& "$PSScriptRoot\build_product_web_exe.ps1" -Product contract_farming -SkipWeb:$SkipWeb
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
