import importlib
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.erp_env import resolve_bundle_root, resolve_web_dist

# Ensure repo packages are importable: core/, modules/
_REPO = resolve_bundle_root()
_CORE = _REPO / "core"
for p in (_REPO, _CORE):
    if p.is_dir() and str(p) not in sys.path:
        sys.path.insert(0, str(p))

from app.config import get_settings  # noqa: E402
from app.db_bootstrap import ensure_database_exists  # noqa: E402
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
    await ensure_database_exists(str(settings.database_url))
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

    from erp_core.pg_schema import (  # noqa: E402
        apply_postgres_schemas,
        create_schemas,
        migrate_public_tables_to_schemas,
        schemas_for_enabled_modules,
    )

    table_schemas = apply_postgres_schemas(Base)
    schema_list = schemas_for_enabled_modules(enabled_modules())
    init_engine(
        settings.database_url,
        echo=settings.sql_echo,
        search_path_schemas=schema_list,
    )

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: create_schemas(sync_conn, schema_list))
        if module_enabled("hospital"):
            from modules.hospital.hms.schema_rename import rename_service_categories_to_groups

            await rename_service_categories_to_groups(conn)
        await conn.run_sync(lambda sync_conn: migrate_public_tables_to_schemas(sync_conn, table_schemas))
        await conn.run_sync(Base.metadata.create_all)
        await ensure_added_columns(conn)
        if module_enabled("hospital"):
            from modules.hospital.hms.schema_columns import ensure_hospital_columns

            await ensure_hospital_columns(conn)

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
        try:
            audit_mod = importlib.import_module("modules.generp.ge.services.audit_middleware")
            app.add_middleware(audit_mod.AuditTrailMiddleware)
            ge_cfg = importlib.import_module("modules.generp.ge.config")
            ge = ge_cfg.get_settings()
            app.mount(
                "/media/products",
                StaticFiles(directory=str(ge.product_images_dir)),
                name="product_images",
            )
            app.mount(
                "/media/parties",
                StaticFiles(directory=str(ge.party_images_dir)),
                name="party_images",
            )
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
        except ModuleNotFoundError:
            logger.info("GenERP media mounts skipped (module not packaged)")

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "product": get_product_name(),
            "display_name": load_product_config().get("display_name"),
            "modules": load_product_config().get("modules"),
        }

    _mount_web_spa(app)
    return app


def _mount_web_spa(app: FastAPI) -> None:
    """Serve the Vite React UI from the packaged backend (PostgreSQL stays external)."""
    web_dir = resolve_web_dist()
    if web_dir is None:
        logger.info("Web UI not bundled (web/dist missing) — API-only mode.")
        return

    index = web_dir / "index.html"
    assets = web_dir / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="web_assets")

    reserved = {"api", "docs", "redoc", "openapi.json", "health", "media"}

    @app.get("/")
    async def spa_index():
        return FileResponse(index)

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        first = (full_path or "").split("/", 1)[0]
        if first in reserved:
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        candidate = (web_dir / full_path).resolve()
        try:
            candidate.relative_to(web_dir.resolve())
        except ValueError:
            return FileResponse(index)
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index)

    logger.info("Web UI served from %s", web_dir)


app = create_app()
