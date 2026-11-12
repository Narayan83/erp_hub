import importlib
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Ensure repo packages are importable: core/, modules/
_REPO = Path(__file__).resolve().parents[3]
_CORE = _REPO / "core"
for p in (_REPO, _CORE):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from app.config import get_settings  # noqa: E402
from erp_core.api.deps import configure_auth  # noqa: E402
from erp_core.api.endpoints.auth import configure_auth_routes  # noqa: E402
from erp_core.api.router import core_router  # noqa: E402
from erp_core.database import Base, get_engine, get_session_factory, init_engine  # noqa: E402
from erp_core.product_config import (  # noqa: E402
    enabled_modules,
    get_product_name,
    load_product_config,
    module_enabled,
)
from erp_core.schema_sync import ensure_added_columns  # noqa: E402
from erp_core.services.seed import seed_initial_data  # noqa: E402

logger = logging.getLogger(__name__)
settings = get_settings()

# Align env with Settings before product_config cache
os.environ.setdefault("ERP_PRODUCT", settings.erp_product)


async def _bootstrap() -> None:
    init_engine(settings.database_url, echo=settings.sql_echo)
    configure_auth(secret_key=settings.secret_key, algorithm=settings.algorithm)
    configure_auth_routes(
        secret_key=settings.secret_key, idle_minutes=settings.idle_timeout_minutes
    )

    # Register models for the active product only.
    import erp_core.models  # noqa: F401

    for name in enabled_modules():
        if name == "core":
            continue
        try:
            importlib.import_module(f"modules.{name}.models")
        except ModuleNotFoundError:
            logger.info("Module %s has no models package", name)

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await ensure_added_columns(conn)

    if settings.seed_on_startup:
        SessionLocal = get_session_factory()
        async with SessionLocal() as session:
            await seed_initial_data(session)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await _bootstrap()
    cfg = load_product_config()
    logger.info("ERP Platform started product=%s modules=%s", get_product_name(), cfg.get("modules"))
    yield


def create_app() -> FastAPI:
    cfg = load_product_config()
    app = FastAPI(
        title=str(cfg.get("display_name") or settings.app_name),
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Product routers first so a complete module (GenERP) wins shared paths
    # such as /parties and /company-profile. A new project is picked up from
    # config/products/*.json + modules/<name>/api/router.py (module_api).
    for name in enabled_modules():
        if name == "core":
            continue
        try:
            mod = importlib.import_module(f"modules.{name}.api.router")
        except ModuleNotFoundError:
            logger.info("Module %s has no API router", name)
            continue
        router = getattr(mod, "module_api", None) or getattr(mod, f"{name}_api", None)
        if router is None:
            continue
        mount = getattr(mod, "MOUNT_PREFIX", f"/{name}")
        app.include_router(router, prefix=f"{settings.api_v1_prefix}{mount}", tags=[name])

    app.include_router(core_router, prefix=settings.api_v1_prefix)

    if module_enabled("generp"):
        from modules.generp.ge.services.audit_middleware import AuditTrailMiddleware

        app.add_middleware(AuditTrailMiddleware)
        from modules.generp.ge.config import get_settings as generp_settings

        ge = generp_settings()
        app.mount("/media/products", StaticFiles(directory=str(ge.product_images_dir)), name="product_images")
        app.mount("/media/parties", StaticFiles(directory=str(ge.party_images_dir)), name="party_images")
        app.mount(
            "/media/shop-banners",
            StaticFiles(directory=str(ge.shop_banners_dir)),
            name="shop_banners",
        )
        app.mount(
            "/media/company-logo",
            StaticFiles(directory=str(ge.company_logo_dir)),
            name="company_logo",
        )

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "product": get_product_name(),
            "display_name": load_product_config().get("display_name"),
            "modules": load_product_config().get("modules"),
        }

    return app


app = create_app()
