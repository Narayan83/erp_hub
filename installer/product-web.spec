# -*- mode: python ; coding: utf-8 -*-
# Shared product EXE (API + embedded web UI).
# Build:  .\scripts\build_<product>_web_exe.ps1
# Reads ERP_PRODUCT from the environment during analysis.

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

PRODUCT = (os.environ.get("ERP_PRODUCT") or "hospital").strip().lower()

PRODUCT_EXE = {
    "hospital": "Hospital",
    "generp": "Generp",
    "lodge": "Lodge",
    "kramcop": "Kramcop",
    "contract_farming": "ContractFarming",
}
PRODUCT_MODULES = {
    "hospital": "modules.hospital",
    "generp": "modules.generp",
    "lodge": "modules.lodge",
    "kramcop": "modules.kramcop",
    "contract_farming": "modules.contract_farming",
}
PRODUCT_DATA = {
    "hospital": ("modules/hospital/data", "modules/hospital/data"),
    "generp": ("modules/generp/data", "modules/generp/data"),
    "lodge": ("modules/lodge/data", "modules/lodge/data"),
    "kramcop": ("modules/kramcop/data", "modules/kramcop/data"),
    "contract_farming": ("modules/contract_farming/data", "modules/contract_farming/data"),
}

if PRODUCT not in PRODUCT_EXE:
    raise SystemExit(f"Unknown ERP_PRODUCT={PRODUCT!r}. Expected one of: {', '.join(PRODUCT_EXE)}")

EXE_NAME = PRODUCT_EXE[PRODUCT]
MODULE_PKG = PRODUCT_MODULES[PRODUCT]
OTHER_MODULES = [pkg for key, pkg in PRODUCT_MODULES.items() if key != PRODUCT]

SPECDIR = Path(SPEC).resolve().parent
ROOT = SPECDIR.parent
API = ROOT / "apps" / "api"
CORE = ROOT / "core"
WEB_DIST = ROOT / "apps" / "web" / "dist"
PRODUCTS = ROOT / "config" / "products"

for p in (str(ROOT), str(CORE), str(API)):
    if p not in sys.path:
        sys.path.insert(0, p)

if not (WEB_DIST / "index.html").is_file():
    raise SystemExit(f"Missing web build: {WEB_DIST}\\index.html - run npm run build first")

datas = [
    (str(WEB_DIST), "web"),
    (str(PRODUCTS), "config/products"),
]
data_src_rel, data_dest = PRODUCT_DATA[PRODUCT]
data_src = ROOT / data_src_rel
if data_src.is_dir():
    datas.append((str(data_src), data_dest))

hiddenimports = [
    "app.main",
    "app.erp_env",
    "app.db_bootstrap",
    "app.config",
    *collect_submodules("app"),
    *collect_submodules("erp_core"),
    *collect_submodules(MODULE_PKG),
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
        *OTHER_MODULES,
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
    name=EXE_NAME,
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
