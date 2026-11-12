import os
import sys
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "core"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Load .env into os.environ early for ERP_PRODUCT
env_path = Path(__file__).resolve().parent / ".env"
if env_path.is_file():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

if __name__ == "__main__":
    port = int(os.environ.get("BACKEND_PORT", "8030"))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        reload_dirs=[
            str(ROOT / "apps" / "api" / "app"),
            str(ROOT / "core"),
            str(ROOT / "modules"),
            str(ROOT / "config"),
        ],
    )
