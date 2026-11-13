# ERP Platform — start API (+ optional web)
# Usage (from repo root):
#   .\run.ps1              # API only
#   .\run.ps1 -Web         # API + Vite web in a second window
#   .\run.ps1 -Product generp
param(
    [switch]$Web,
    [ValidateSet("hospital", "generp", "lodge", "kramcop", "contract_farming")]
    [string]$Product = ""
)

$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$ApiDir = Join-Path $Root "apps\api"
$WebDir = Join-Path $Root "apps\web"
$Port = 8030
$BaseUrl = "http://127.0.0.1:$Port"

function Test-PythonCmd([string]$exe, [string[]]$extraArgs = @()) {
    if (-not $exe) { return $false }
    if ($exe -notmatch '^(py|python|python3)(\.exe)?$' -and -not (Test-Path $exe)) { return $false }
    try {
        $out = & $exe @extraArgs --version 2>&1
        if ($LASTEXITCODE -ne 0) { return $false }
        return ($out -match 'Python 3\.')
    } catch {
        return $false
    }
}

function Find-Python {
    # 1) Prefer existing API venv (works even when Python is not on PATH)
    $venvPy = Join-Path $ApiDir ".venv\Scripts\python.exe"
    if (Test-PythonCmd $venvPy) { return $venvPy }

    # 2) PATH / launcher
    foreach ($pair in @(
        @{ Exe = "py"; Args = @("-3") },
        @{ Exe = "python"; Args = @() },
        @{ Exe = "python3"; Args = @() }
    )) {
        if (Test-PythonCmd $pair.Exe $pair.Args) {
            if ($pair.Args.Count) { return ($pair.Exe + " " + ($pair.Args -join " ")) }
            return $pair.Exe
        }
    }

    # 3) Common Windows install locations
    $local = $env:LOCALAPPDATA
    $candidates = @(
        (Join-Path $local "Programs\Python\Launcher\py.exe"),
        (Join-Path $local "Programs\Python\Python312\python.exe"),
        (Join-Path $local "Programs\Python\Python311\python.exe"),
        (Join-Path $local "Programs\Python\Python310\python.exe"),
        "C:\Python312\python.exe",
        "C:\Python311\python.exe"
    )
    foreach ($c in $candidates) {
        if (Test-PythonCmd $c) { return $c }
        if (($c -like "*\py.exe") -and (Test-PythonCmd $c @("-3"))) { return "$c -3" }
    }

    throw "Python 3 not found. Install Python 3.12+ or create apps\api\.venv."
}

function Ensure-ApiVenv {
    $venvPy = Join-Path $ApiDir ".venv\Scripts\python.exe"
    if (-not (Test-Path $venvPy)) {
        Write-Host "Creating apps\api\.venv ..." -ForegroundColor DarkGray
        $parts = @($script:PyLauncher -split " ", 2)
        $exe = $parts[0]
        $extra = @()
        if ($parts.Count -gt 1 -and $parts[1]) { $extra = $parts[1].Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries) }
        Push-Location $ApiDir
        try {
            & $exe @extra -m venv .venv
        } finally {
            Pop-Location
        }
    }
    if (-not (Test-Path $venvPy)) {
        throw "Failed to create apps\api\.venv\Scripts\python.exe"
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

$productLabel = $Product
if (-not $productLabel -and (Test-Path (Join-Path $ApiDir ".env"))) {
    $m = Select-String -Path (Join-Path $ApiDir ".env") -Pattern "(?m)^ERP_PRODUCT\s*=\s*(.+)$" | Select-Object -First 1
    if ($m) { $productLabel = $m.Matches[0].Groups[1].Value.Trim() }
}
if (-not $productLabel) { $productLabel = "hospital" }

if ($Web) {
    Write-Host "Starting web (Vite) in a new window ..." -ForegroundColor Yellow
    $npmDir = @(
        "$env:ProgramFiles\nodejs",
        "${env:ProgramFiles(x86)}\nodejs",
        "$env:LOCALAPPDATA\Programs\nodejs"
    ) | Where-Object { Test-Path (Join-Path $_ "npm.cmd") } | Select-Object -First 1
    $pathPrefix = if ($npmDir) { "`$env:Path = '$npmDir;' + `$env:Path; " } else { "" }
    $webCmd = "${pathPrefix}Set-Location `"$WebDir`"; if (-not (Test-Path node_modules)) { npm install }; npm run dev"
    Start-Process powershell -ArgumentList "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $webCmd
}

Write-Host "Starting API at $BaseUrl" -ForegroundColor Green
Write-Host "Health: $BaseUrl/health   Docs: $BaseUrl/docs" -ForegroundColor DarkGray
Write-Host "Web (if -Web): http://127.0.0.1:5173" -ForegroundColor DarkGray
Write-Host "Login: admin@$productLabel.example.com / admin123  ($productLabel product)" -ForegroundColor DarkGray
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

Set-Location $ApiDir
& $py (Join-Path $ApiDir "run_server.py")
