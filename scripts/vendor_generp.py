"""Copy GenERP backend, web screens, and tests into the hub. Re-runnable."""

from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC_BE = Path(r"D:\fullstack\others\generp\backend\app")
SRC_WEB = Path(r"D:\fullstack\others\generp\web\src")
SRC_TESTS = Path(r"D:\fullstack\others\generp\backend\tests")
GE = ROOT / "modules" / "generp" / "ge"
WEB = ROOT / "apps" / "web" / "src"

REMOVE_CLASSES = {"CompanyProfile", "PrintConfig", "Ledger", "PaymentMode", "Party"}


def rewrite_py(text: str) -> str:
    text = text.replace("from app.", "from modules.generp.ge.")
    text = text.replace("import app.", "import modules.generp.ge.")
    return text


def copy_backend() -> None:
    if GE.exists():
        shutil.rmtree(GE)
    shutil.copytree(
        SRC_BE,
        GE,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    for path in GE.rglob("*.py"):
        path.write_text(rewrite_py(path.read_text(encoding="utf-8")), encoding="utf-8")
    strip_shared_models(GE / "models" / "masters.py")
    dash = GE / "models" / "dashboard.py"
    dash.write_text(
        dash.read_text(encoding="utf-8").replace(
            '__tablename__ = "dashboard_shortcuts"',
            '__tablename__ = "generp_dashboard_shortcuts"',
        ),
        encoding="utf-8",
    )


def strip_shared_models(path: Path) -> None:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    out: list[str] = []
    skipping = False
    for line in lines:
        if line.startswith("class "):
            name = line.split("class ", 1)[1].split("(", 1)[0].strip()
            skipping = name in REMOVE_CLASSES
        if not skipping:
            out.append(line)
    text = "".join(out)
    text = text.replace(
        "from modules.generp.ge.core.database import Base\n",
        "from erp_core.database import Base\n"
        "from erp_core.models.masters import (\n"
        "    CompanyProfile,\n"
        "    Ledger,\n"
        "    Party,\n"
        "    PaymentMode,\n"
        "    PrintConfig,\n"
        ")\n",
    )
    path.write_text(text, encoding="utf-8")


def copy_tests() -> None:
    dest = ROOT / "modules" / "generp" / "tests"
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    (dest / "__init__.py").write_text("", encoding="utf-8")
    for path in SRC_TESTS.glob("*.py"):
        text = rewrite_py(path.read_text(encoding="utf-8"))
        text = text.replace("http://127.0.0.1:8020", "http://127.0.0.1:8030")
        text = text.replace("admin@admin.com", "admin@generp.example.com")
        (dest / path.name).write_text(text, encoding="utf-8")
    (dest / "conftest.py").write_text(
        "import sys\nfrom pathlib import Path\n\n"
        "ROOT = Path(__file__).resolve().parents[3]\n"
        "sys.path.insert(0, str(ROOT))\n"
        "sys.path.insert(0, str(ROOT / 'core'))\n"
        "sys.path.insert(0, str(ROOT / 'apps' / 'api'))\n",
        encoding="utf-8",
    )


def _rewrite_web(text: str, kind: str) -> str:
    if kind == "page":
        text = text.replace("from '../api/", "from '../../api/")
        text = text.replace("from '../auth/", "from '../../auth/")
        text = text.replace("from '../components/", "from '../../components/generp/")
        text = text.replace("from '../lib/", "from '../../lib/generp/")
        text = text.replace("from '../types'", "from '../../generpTypes'")
        text = text.replace("from '../menuPages'", "from './menuPages'")
    elif kind == "component":
        text = text.replace("from '../api/", "from '../../api/")
        text = text.replace("from '../auth/", "from '../../auth/")
        text = text.replace("from '../lib/", "from '../../lib/generp/")
        text = text.replace("from '../types'", "from '../../generpTypes'")
        text = text.replace("from '../pages/", "from '../../pages/generp/")
        text = text.replace("from '../menuPages'", "from '../../pages/generp/menuPages'")
    elif kind == "lib":
        text = text.replace("from '../api/", "from '../../api/")
        text = text.replace("from '../types'", "from '../../generpTypes'")
    return text


def copy_web() -> None:
    pages = WEB / "pages" / "generp"
    comps = WEB / "components" / "generp"
    libs = WEB / "lib" / "generp"
    if pages.exists():
        shutil.rmtree(pages)
    pages.mkdir(parents=True)
    comps.mkdir(parents=True, exist_ok=True)
    libs.mkdir(parents=True, exist_ok=True)

    skip_pages = {"LoginPage.tsx", "App.tsx"}
    for path in (SRC_WEB / "pages").glob("*.tsx"):
        if path.name in skip_pages:
            continue
        text = _rewrite_web(path.read_text(encoding="utf-8"), "page")
        (pages / path.name).write_text(text, encoding="utf-8")
    stock = SRC_WEB / "pages" / "stockModes.ts"
    if stock.is_file():
        (pages / "stockModes.ts").write_text(stock.read_text(encoding="utf-8"), encoding="utf-8")

    skip_components = {"AppLayout.tsx", "WorkspaceHost.tsx"}
    for path in (SRC_WEB / "components").glob("*.tsx"):
        if path.name in skip_components:
            continue
        text = _rewrite_web(path.read_text(encoding="utf-8"), "component")
        (comps / path.name).write_text(text, encoding="utf-8")

    for path in (SRC_WEB / "lib").glob("*.ts"):
        text = _rewrite_web(path.read_text(encoding="utf-8"), "lib")
        (libs / path.name).write_text(text, encoding="utf-8")

    types = SRC_WEB / "types" / "index.ts"
    (WEB / "generpTypes.ts").write_text(types.read_text(encoding="utf-8"), encoding="utf-8")

    menu = (SRC_WEB / "menuPages.tsx").read_text(encoding="utf-8")
    menu = menu.replace("from './pages/", "from './")
    menu = menu.replace("from './components/", "from '../../components/generp/")
    menu = menu.replace(
        "export function renderMenuPage(raw: string)",
        "export function renderGenerpMenuPage(raw: string)",
    )
    (pages / "menuPages.tsx").write_text(menu, encoding="utf-8")

    css = (SRC_WEB / "index.css").read_text(encoding="utf-8")
    (WEB / "generp.css").write_text(css, encoding="utf-8")

    roles = (SRC_WEB / "auth" / "roles.ts").read_text(encoding="utf-8")
    (WEB / "auth" / "roles.ts").write_text(roles, encoding="utf-8")


if __name__ == "__main__":
    copy_backend()
    copy_tests()
    copy_web()
    print("vendored", GE)
