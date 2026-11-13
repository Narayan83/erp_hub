# -*- mode: python ; coding: utf-8 -*-
# Kramcop — one EXE with API + embedded web UI (GenERP-style)
# Build:  .\scripts\build_kramcop_web_exe.ps1

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

SPECDIR = Path(SPEC).resolve().parent
ROOT = SPECDIR.parent
API = ROOT / "apps" / "api"
CORE = ROOT / "core"
WEB_DIST = ROOT / "apps" / "web" / "dist"
PRODUCTS = ROOT / "config" / "products"
KRAM_DATA = ROOT / "modules" / "kramcop" / "data"

# So collect_submodules can import erp_core / modules.kramcop during analysis
for p in (str(ROOT), str(CORE), str(API)):
    if p not in sys.path:
        sys.path.insert(0, p)

if not (WEB_DIST / "index.html").is_file():
    raise SystemExit(f"Missing web build: {WEB_DIST}\\index.html - run npm run build first")

datas = [
    (str(WEB_DIST), "web"),
    (str(PRODUCTS), "config/products"),
]
if KRAM_DATA.is_dir():
    datas.append((str(KRAM_DATA), "modules/kramcop/data"))

hiddenimports = [
    "app.main",
    "app.erp_env",
    "app.db_bootstrap",
    "app.config",
    *collect_submodules("app"),
    *collect_submodules("erp_core"),
    *collect_submodules("modules.kramcop"),
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "asyncpg",
    "sqlalchemy.dialects.postgresql",
    "sqlalchemy.dialects.postgresql.asyncpg",
    "email_validator",
    "bcrypt",
    "openpyxl",
    "multipart",
]

a = Analysis(
    [str(API / "run_server.py")],
    pathex=[str(API), str(CORE), str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "modules.hospital",
        "modules.generp",
        "modules.lodge",
        "pytest",
        "_pytest",
        "pygments",
        "watchfiles",
        "matplotlib",
        "numpy",
        "pandas",
        "scipy",
        "tkinter",
        "IPython",
        "notebook",
        "unittest",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="Kramcop",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
