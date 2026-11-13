"""Kramcop data/storage paths (dev repo or packaged EXE)."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _module_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def resolve_storage_root() -> Path:
    explicit = os.environ.get("ERP_ROOT", "").strip()
    if explicit:
        root = Path(explicit) / "data" / "storage" / "kramcop"
    elif getattr(sys, "frozen", False):
        root = Path(sys.executable).resolve().parent / "data" / "storage" / "kramcop"
    else:
        # modules/kramcop/kc → repo / storage / kramcop
        root = Path(__file__).resolve().parents[3] / "storage" / "kramcop"
    root.mkdir(parents=True, exist_ok=True)
    return root


def resolve_data_dir() -> Path:
    if getattr(sys, "frozen", False):
        bundled = Path(getattr(sys, "_MEIPASS")) / "modules" / "kramcop" / "data"
        if bundled.is_dir():
            return bundled
    return _module_dir() / "data"
