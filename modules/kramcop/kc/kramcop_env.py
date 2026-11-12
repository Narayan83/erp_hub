"""Kramcop files live under this repo, not a separate install."""

from __future__ import annotations

from pathlib import Path


def _module_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def resolve_storage_root() -> Path:
    # modules/kramcop/kc/kramcop_env.py -> repo / storage / kramcop
    root = Path(__file__).resolve().parents[3] / "storage" / "kramcop"
    root.mkdir(parents=True, exist_ok=True)
    return root


def resolve_data_dir() -> Path:
    return _module_dir() / "data"
