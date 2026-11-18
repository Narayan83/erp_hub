#Requires -Version 5.1
<#
.SYNOPSIS
  Build one product EXE (API + web UI inside). Opens browser on double-click.

.PARAMETER Product
  hospital | generp | lodge | kramcop | contract_farming

.EXAMPLE
  .\scripts\build_product_web_exe.ps1 -Product hospital
  .\scripts\build_product_web_exe.ps1 -Product kramcop -SkipWeb
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("hospital", "generp", "lodge", "kramcop", "contract_farming")]
    [string]$Product,

    [switch]$SkipWeb
)

$ErrorActionPreference = "Stop"

$ExeNames = @{
    hospital           = "Hospital"
    generp             = "Generp"
    lodge              = "Lodge"
    kramcop            = "Kramcop"
    contract_farming   = "ContractFarming"
}
$Logins = @{
    hospital           = "hospital"
    generp             = "generp"
    lodge              = "lodge"
    kramcop            = "kramcop"
    contract_farming   = "contract_farming"
}

$ExeName = $ExeNames[$Product]
$Login = $Logins[$Product]
$Root = Split-Path $PSScriptRoot -Parent
$Web = Join-Path $Root "apps\web"
$Api = Join-Path $Root "apps\api"
$Release = Join-Path $Root "installer\release"
$Spec = Join-Path $Root "installer\product-web.spec"

function Find-Npm {
    $cmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        "$env:ProgramFiles\nodejs\npm.cmd",
        "${env:ProgramFiles(x86)}\nodejs\npm.cmd",
        "$env:LOCALAPPDATA\Programs\nodejs\npm.cmd"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    throw "npm not found. Install Node.js 20+ and ensure it is on PATH."
}

function Find-Python {
    foreach ($name in @("py", "python", "python3")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        $src = $cmd.Source
        if ($src -match "WindowsApps") { continue }
        try {
            if ($name -eq "py") {
                & $src -3 --version *> $null
                if ($LASTEXITCODE -eq 0) { return @($src, "-3") }
            } else {
                & $src --version *> $null
                if ($LASTEXITCODE -eq 0) { return @($src) }
            }
        } catch {}
    }
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
        "$env:ProgramFiles\Python312\python.exe",
        "C:\Python312\python.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return @($c) }
    }
    throw "Python 3.12+ not found. Install Python and ensure it is on PATH."
}

function Test-VenvPython([string]$venvPy) {
    if (-not (Test-Path $venvPy)) { return $false }
    try {
        & $venvPy -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" *> $null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

if (-not $SkipWeb) {
    Write-Host "=== 1/3 Build web UI ===" -ForegroundColor Cyan
    $npm = Find-Npm
    Set-Location $Web
    if (-not (Test-Path "node_modules")) {
        & $npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    }
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
} else {
    Write-Host "=== 1/3 Skip web build (using existing apps\web\dist) ===" -ForegroundColor DarkGray
}

if (-not (Test-Path (Join-Path $Web "dist\index.html"))) {
    throw "apps\web\dist\index.html missing — run without -SkipWeb first"
}

Write-Host "=== 2/3 Install Python deps + PyInstaller ===" -ForegroundColor Cyan
Set-Location $Api
$venvPy = Join-Path $Api ".venv\Scripts\python.exe"
if (-not (Test-VenvPython $venvPy)) {
    Write-Host "Creating/repairing apps\api\.venv ..." -ForegroundColor DarkGray
    $oldVenv = Join-Path $Api ".venv"
    if (Test-Path -LiteralPath $oldVenv) {
        # A corrupt NTFS directory makes Remove-Item throw "corrupted and unreadable".
        # Rename it aside so python -m venv can create a fresh tree.
        try {
            Remove-Item -LiteralPath $oldVenv -Recurse -Force -ErrorAction Stop
        } catch {
            $aside = ".venv.unreadable-" + (Get-Date -Format "yyyyMMddHHmmss")
            Write-Host "Could not delete apps\api\.venv ($($_.Exception.Message)). Moving it to apps\api\$aside" -ForegroundColor DarkYellow
            Rename-Item -LiteralPath $oldVenv -NewName $aside
        }
    }
    $py = Find-Python
    if ($py.Count -gt 1) {
        & $py[0] $py[1] -m venv .venv
    } else {
        & $py[0] -m venv .venv
    }
    if ($LASTEXITCODE -ne 0) { throw "python -m venv failed" }
}
# Use python -m pip (not pip.exe) — App Control / WDAC often blocks Scripts\pip.exe
& $venvPy -m pip install -q -r (Join-Path $Api "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "pip install requirements failed" }
& $venvPy -m pip install -q pyinstaller
if ($LASTEXITCODE -ne 0) { throw "pip install pyinstaller failed" }

Write-Host "=== 3/3 Build $ExeName.exe (web embedded) ===" -ForegroundColor Cyan
Set-Location $Root
$env:ERP_PRODUCT = $Product
& $venvPy -m PyInstaller --noconfirm --clean $Spec
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

New-Item -ItemType Directory -Force -Path $Release | Out-Null
$built = Join-Path $Root "dist\$ExeName.exe"
if (-not (Test-Path $built)) {
    $alt = Join-Path $Api "dist\$ExeName.exe"
    if (Test-Path $alt) { $built = $alt }
}
if (-not (Test-Path $built)) { throw "$ExeName.exe not found after build" }

Copy-Item $built (Join-Path $Release "$ExeName.exe") -Force

Write-Host ""
Write-Host "DONE - give the client ONLY this file:" -ForegroundColor Green
Write-Host "  $Release\$ExeName.exe" -ForegroundColor Green
Write-Host ""
Write-Host "On client PC:" -ForegroundColor Yellow
Write-Host "  1. Install PostgreSQL (default user postgres / set password)"
Write-Host "  2. Copy $ExeName.exe anywhere and double-click"
Write-Host "  3. Edit config\$Product.env if password is not 'postpass'"
Write-Host "  4. Browser opens at http://127.0.0.1:8030"
Write-Host "     Login: $Login / admin123"
Write-Host "Update later = replace this one EXE only."
