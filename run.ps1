# ERP Platform — start API (+ optional web)
# Usage (from repo root):
#   .\run.ps1              # API only
#   .\run.ps1 -Web         # API + Vite web in a second window
#   .\run.ps1 -Product generp
param(
    [switch]$Web,
    [ValidateSet("hospital", "generp", "lodge", "kramcop")]
    [string]$Product = ""
)

$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$ApiDir = Join-Path $Root "apps\api"
$WebDir = Join-Path $Root "apps\web"
$Port = 8030
$BaseUrl = "http://127.0.0.1:$Port"

function Find-Python {
    foreach ($cmd in @("py -3", "python", "python3")) {
        try {
            $parts = $cmd.Split(" ")
            & $parts[0] $parts[1..($parts.Length - 1)] --version *> $null
            if ($LASTEXITCODE -eq 0) { return $cmd }
        } catch {}
    }
    throw "Python 3 not found on PATH."
}

function Ensure-ApiVenv {
    $venvPy = Join-Path $ApiDir ".venv\Scripts\python.exe"
    if (-not (Test-Path $venvPy)) {
        Write-Host "Creating apps\api\.venv ..." -ForegroundColor DarkGray
        $parts = $script:PyLauncher.Split(" ")
        Push-Location $ApiDir
        try {
            & $parts[0] $parts[1..($parts.Length - 1)] -m venv .venv
        } finally {
            Pop-Location
        }
    }
    return $venvPy
}

function Ensure-ApiDeps([string]$py) {
    $req = Join-Path $ApiDir "requirements.txt"
    $stamp = Join-Path $ApiDir ".venv\.deps_installed"
    $needs = $true
    if ((Test-Path $stamp) -and (Test-Path $req)) {
        if ((Get-Item $req).LastWriteTime -le (Get-Item $stamp).LastWriteTime) {
            $needs = $false
        }
    }
    if ($needs) {
        Write-Host "Installing API dependencies ..." -ForegroundColor DarkGray
        & $py -m pip install --upgrade pip *> $null
        & $py -m pip install -r $req
        if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
        New-Item -ItemType File -Path $stamp -Force | Out-Null
    }
}

function Ensure-EnvFile([string]$product) {
    $envFile = Join-Path $ApiDir ".env"
    $example = Join-Path $ApiDir ".env.example"
    if (-not (Test-Path $envFile) -and (Test-Path $example)) {
        Copy-Item $example $envFile
        Write-Host "Created apps\api\.env from .env.example" -ForegroundColor DarkGray
    }
    if ($product -and (Test-Path $envFile)) {
        $text = Get-Content $envFile -Raw
        if ($text -match "(?m)^ERP_PRODUCT\s*=") {
            $text = [regex]::Replace($text, "(?m)^ERP_PRODUCT\s*=.*$", "ERP_PRODUCT=$product")
        } else {
            $text = "ERP_PRODUCT=$product`r`n" + $text
        }
        Set-Content -Path $envFile -Value $text -NoNewline
        Write-Host "ERP_PRODUCT=$product" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "=== ERP Platform ===" -ForegroundColor Cyan
Write-Host "Root: $Root" -ForegroundColor DarkGray
Write-Host ""

$script:PyLauncher = Find-Python
$py = Ensure-ApiVenv
Ensure-ApiDeps $py
Ensure-EnvFile $Product

if ($Web) {
    Write-Host "Starting web (Vite) in a new window ..." -ForegroundColor Yellow
    $webCmd = "Set-Location `"$WebDir`"; if (-not (Test-Path node_modules)) { npm install }; npm run dev"
    Start-Process powershell -ArgumentList "-NoExit", "-NoProfile", "-Command", $webCmd
}

Write-Host "Starting API at $BaseUrl" -ForegroundColor Green
Write-Host "Health: $BaseUrl/health   Docs: $BaseUrl/docs" -ForegroundColor DarkGray
Write-Host "Web (if -Web): http://127.0.0.1:5173" -ForegroundColor DarkGray
Write-Host "Login: admin@$Product.example.com / admin123  ($Product product)" -ForegroundColor DarkGray
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

Set-Location $ApiDir
& $py (Join-Path $ApiDir "run_server.py")
