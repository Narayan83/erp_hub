"""Load product JSON (hospital | generp | lodge | kramcop) and expose labels/modules."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any


def _repo_root() -> Path:
    # core/erp_core/product_config.py → repo root
    return Path(__file__).resolve().parents[2]


def products_dir() -> Path:
    override = os.environ.get("ERP_PRODUCTS_DIR")
    if override:
        return Path(override)
    return _repo_root() / "config" / "products"


def available_products() -> list[str]:
    folder = products_dir()
    if not folder.is_dir():
        return []
    return sorted(p.stem for p in folder.glob("*.json") if p.is_file())


@lru_cache
def get_product_name() -> str:
    name = (os.environ.get("ERP_PRODUCT") or "hospital").strip().lower()
    if name not in set(available_products()):
        known = ", ".join(available_products()) or "(none)"
        raise ValueError(f"Invalid ERP_PRODUCT={name!r}; available: {known}")
    return name


@lru_cache
def load_product_config() -> dict[str, Any]:
    path = products_dir() / f"{get_product_name()}.json"
    if not path.is_file():
        raise FileNotFoundError(f"Product config not found: {path}")
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    data.setdefault("labels", {})
    data.setdefault("modules", ["core"])
    return data


def label(key: str, default: str | None = None) -> str:
    cfg = load_product_config()
    return str(cfg.get("labels", {}).get(key, default or key))


def enabled_modules() -> list[str]:
    return list(load_product_config().get("modules") or ["core"])


def module_enabled(name: str) -> bool:
    return name in enabled_modules()


def installed_module_names() -> list[str]:
    """Folders under modules/ that ship a menus.py. Adding a project is a new folder + json."""
    root = _repo_root() / "modules"
    if not root.is_dir():
        return []
    return sorted(
        p.name for p in root.iterdir() if p.is_dir() and (p / "menus.py").is_file()
    )


def load_module_menus(name: str) -> list[tuple]:
    import importlib

    mod = importlib.import_module(f"modules.{name}.menus")
    menus = getattr(mod, "MENUS", None)
    if menus is None:
        menus = getattr(mod, f"{name.upper()}_MENUS", [])
    return list(menus)
