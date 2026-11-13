import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from modules.generp.ge.api.v1.router import api_router
from modules.generp.ge.config import get_settings
from modules.generp.ge.core.database import AsyncSessionLocal, Base, engine
from modules.generp.ge.services.audit_middleware import AuditTrailMiddleware
from modules.generp.ge.db_bootstrap import ensure_database_exists
from modules.generp.ge.generp_env import resolve_web_dist
from modules.generp.ge.seeds.bootstrap import seed_initial_data

logger = logging.getLogger(__name__)


async def _create_tables() -> None:
    # Import models so every table is registered on Base.metadata before create_all.
    import modules.generp.ge.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # create_all does not add columns to existing tables — patch forward.
        await conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(20)"))
        await conn.execute(
            text(
                "ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_price "
                "NUMERIC(14, 2) DEFAULT 0"
            )
        )
        await conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS image_path VARCHAR(300)"))
        await conn.execute(
            text("ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES products(id)")
        )
        await conn.execute(
            text("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_in_shop BOOLEAN DEFAULT FALSE")
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_products_is_in_shop ON products (is_in_shop)")
        )
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_products_parent_id ON products (parent_id)"))
        # Multi-image gallery (backward-compat: products.image_path stays as primary)
        await conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS product_images (
                    id UUID PRIMARY KEY,
                    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                    file_path VARCHAR(300) NOT NULL,
                    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_product_images_product_id ON product_images (product_id)")
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_product_images_is_primary ON product_images (is_primary)")
        )
        # Migrate legacy single image_path rows into the gallery once.
        await conn.execute(
            text(
                """
                INSERT INTO product_images (id, product_id, file_path, is_primary, sort_order, is_active)
                SELECT gen_random_uuid(), p.id, p.image_path, TRUE, 0, TRUE
                FROM products p
                WHERE p.image_path IS NOT NULL
                  AND p.image_path <> ''
                  AND NOT EXISTS (
                    SELECT 1 FROM product_images pi WHERE pi.product_id = p.id AND pi.is_active
                  )
                """
            )
        )
        await conn.execute(
            text(
                """
                UPDATE products
                SET barcode = lpad(code, 6, '0')
                WHERE barcode IS NULL
                  AND code ~ '^[0-9]+$'
                  AND length(code) <= 6
                """
            )
        )
        await conn.execute(
            text(
                """
                UPDATE products
                SET barcode = code
                WHERE barcode IS NULL
                """
            )
        )
        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_products_barcode ON products (barcode)"))

        # Per-user menu shortcuts (was a single global unique menu_code)
        await conn.execute(
            text(
                "ALTER TABLE dashboard_shortcuts ADD COLUMN IF NOT EXISTS user_id "
                "UUID REFERENCES users(id) ON DELETE CASCADE"
            )
        )
        await conn.execute(
            text(
                """
                UPDATE dashboard_shortcuts
                SET user_id = created_by
                WHERE user_id IS NULL AND created_by IS NOT NULL
                """
            )
        )
        await conn.execute(
            text("ALTER TABLE dashboard_shortcuts DROP CONSTRAINT IF EXISTS dashboard_shortcuts_menu_code_key")
        )
        await conn.execute(text("DROP INDEX IF EXISTS dashboard_shortcuts_menu_code_key"))
        await conn.execute(text("DROP INDEX IF EXISTS ix_dashboard_shortcuts_menu_code"))
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_dashboard_shortcuts_menu_code ON dashboard_shortcuts (menu_code)")
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_dashboard_shortcuts_user_id ON dashboard_shortcuts (user_id)")
        )
        await conn.execute(
            text(
                "ALTER TABLE dashboard_shortcuts ADD COLUMN IF NOT EXISTS host_code "
                "VARCHAR(80) NOT NULL DEFAULT 'dashboard'"
            )
        )
        await conn.execute(
            text(
                """
                UPDATE dashboard_shortcuts
                SET host_code = 'dashboard'
                WHERE host_code IS NULL OR btrim(host_code) = ''
                """
            )
        )
        await conn.execute(text("DROP INDEX IF EXISTS uq_dashboard_shortcut_user_menu"))
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_dashboard_shortcuts_host_code ON dashboard_shortcuts (host_code)")
        )
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboard_shortcut_user_host_menu "
                "ON dashboard_shortcuts (user_id, host_code, menu_code) "
                "WHERE user_id IS NOT NULL"
            )
        )

        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(80)"))
        await conn.execute(
            text(
                """
                UPDATE users
                SET username = split_part(lower(email), '@', 1)
                WHERE username IS NULL OR btrim(username) = ''
                """
            )
        )
        await conn.execute(
            text(
                """
                UPDATE users
                SET username = username || '-' || substr(replace(id::text, '-', ''), 1, 6)
                WHERE id IN (
                    SELECT id FROM (
                        SELECT id,
                               row_number() OVER (PARTITION BY username ORDER BY created_at, id) AS rn
                        FROM users
                        WHERE username IS NOT NULL AND username <> ''
                    ) d
                    WHERE rn > 1
                )
                """
            )
        )
        await conn.execute(
            text(
                """
                UPDATE users SET username = username || '-1'
                WHERE lower(username) = 'admin' AND lower(email) <> 'admin@admin.com'
                """
            )
        )
        await conn.execute(
            text("UPDATE users SET username = 'admin' WHERE lower(email) = 'admin@admin.com'")
        )
        await conn.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username)")
        )
        await conn.execute(
            text("ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS ledger_type VARCHAR(20) DEFAULT 'ASSET'")
        )
        await conn.execute(
            text("ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS is_cash BOOLEAN DEFAULT FALSE")
        )
        await conn.execute(
            text("ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS is_bank BOOLEAN DEFAULT FALSE")
        )
        await conn.execute(
            text(
                "ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS is_party_deposit BOOLEAN DEFAULT FALSE"
            )
        )
        await conn.execute(
            text("ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS system_key VARCHAR(40)")
        )
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_ledgers_system_key "
                "ON ledgers (system_key) WHERE system_key IS NOT NULL"
            )
        )
        # Party IDs 1,2,3 unique per customer vs vendor series (not globally)
        await conn.execute(text("ALTER TABLE parties DROP CONSTRAINT IF EXISTS parties_code_key"))
        await conn.execute(text("DROP INDEX IF EXISTS parties_code_key"))
        await conn.execute(text("DROP INDEX IF EXISTS ix_parties_code"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_parties_code ON parties (code)"))
        await conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_parties_customer_code
                ON parties (code)
                WHERE party_type IN ('customer', 'both')
                """
            )
        )
        await conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_parties_vendor_code
                ON parties (code)
                WHERE party_type IN ('vendor', 'both')
                """
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS adjust_advance "
                "NUMERIC(14, 2) DEFAULT 0"
            )
        )
        await conn.execute(
            text("ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS party_bill_no VARCHAR(80)")
        )
        await conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details JSONB"))
        await conn.execute(
            text("ALTER TABLE cashbook_voucher_lines ADD COLUMN IF NOT EXISTS narration TEXT")
        )
        await conn.execute(
            text("ALTER TABLE cashbook_vouchers ADD COLUMN IF NOT EXISTS kind VARCHAR(20)")
        )
        await conn.execute(
            text("ALTER TABLE document_sequences ALTER COLUMN name TYPE VARCHAR(160)")
        )
        await conn.execute(
            text("ALTER TABLE document_sequences ALTER COLUMN prefix TYPE VARCHAR(80)")
        )
        await conn.execute(text("ALTER TABLE vouchers ALTER COLUMN voucher_no TYPE VARCHAR(80)"))
        await conn.execute(text("ALTER TABLE orders ALTER COLUMN order_no TYPE VARCHAR(80)"))
        await conn.execute(
            text("ALTER TABLE stock_vouchers ALTER COLUMN voucher_no TYPE VARCHAR(80)")
        )
        await conn.execute(
            text("ALTER TABLE cashbook_vouchers ALTER COLUMN voucher_no TYPE VARCHAR(80)")
        )
        await conn.execute(
            text(
                "ALTER TABLE document_number_rules ADD COLUMN IF NOT EXISTS year_mode "
                "VARCHAR(20) DEFAULT 'financial_year'"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE document_number_rules ADD COLUMN IF NOT EXISTS prefix2 "
                "VARCHAR(12) DEFAULT '01'"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE document_number_rules ADD COLUMN IF NOT EXISTS prefix3 "
                "VARCHAR(12) DEFAULT '01'"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE document_number_rules ADD COLUMN IF NOT EXISTS seq_digits "
                "INTEGER DEFAULT 6"
            )
        )
        await conn.execute(
            text("ALTER TABLE document_number_rules ALTER COLUMN prefix TYPE VARCHAR(20)")
        )
        await conn.execute(
            text(
                """
                UPDATE document_number_rules
                SET prefix2 = '01'
                WHERE prefix2 IS NULL
                """
            )
        )
        await conn.execute(
            text(
                """
                UPDATE document_number_rules
                SET prefix3 = '01'
                WHERE prefix3 IS NULL
                """
            )
        )
        await conn.execute(
            text(
                """
                UPDATE document_number_rules
                SET year_mode = 'financial_year'
                WHERE year_mode IS NULL OR year_mode = ''
                """
            )
        )
        await conn.execute(
            text(
                """
                UPDATE document_number_rules
                SET seq_digits = 6
                WHERE seq_digits IS NULL OR seq_digits < 4
                """
            )
        )
        await conn.execute(
            text(
                """
                UPDATE branches SET code = '001'
                WHERE is_main IS TRUE AND UPPER(code) = 'MAIN'
                  AND NOT EXISTS (SELECT 1 FROM branches b2 WHERE b2.code = '001')
                """
            )
        )
        await conn.execute(
            text(
                """
                UPDATE ledgers SET ledger_type = 'ASSET', is_cash = TRUE
                WHERE code = 'CASH' AND COALESCE(is_cash, FALSE) = FALSE
                """
            )
        )
        await conn.execute(
            text(
                """
                UPDATE ledgers SET ledger_type = 'ASSET', is_bank = TRUE
                WHERE code LIKE 'BANK%' AND COALESCE(is_bank, FALSE) = FALSE
                """
            )
        )
        await conn.execute(
            text(
                """
                UPDATE ledgers SET ledger_type = 'INCOME', opening_type = 'Cr'
                WHERE code IN ('SALES', 'SALE-RECEIPT', 'WSL-RECEIPT')
                """
            )
        )
        await conn.execute(
            text(
                """
                UPDATE ledgers SET ledger_type = 'EXPENSE', opening_type = 'Dr'
                WHERE code IN ('PURCHASE', 'DISCOUNT')
                """
            )
        )
        await conn.execute(
            text(
                """
                UPDATE ledgers SET ledger_type = 'LIABILITY', opening_type = 'Cr'
                WHERE code IN ('GST_OUTPUT', 'CUST-DEPOSIT', 'PARTY-ACCOUNT')
                """
            )
        )
        await conn.execute(
            text(
                """
                UPDATE ledgers SET ledger_type = 'ASSET', opening_type = 'Dr'
                WHERE code = 'GST_INPUT'
                """
            )
        )

        # Product GST amount slabs
        await conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_slabs JSONB"))
        await conn.execute(
            text("ALTER TABLE products ADD COLUMN IF NOT EXISTS item_type VARCHAR(20) DEFAULT 'goods'")
        )
        await conn.execute(
            text(
                "UPDATE products SET item_type = 'goods' "
                "WHERE item_type IS NULL OR item_type = ''"
            )
        )

        # Menu-wise inclusive / exclusive GST
        await conn.execute(
            text(
                "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS sale_tax_mode "
                "VARCHAR(20) DEFAULT 'inclusive'"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS wholesale_tax_mode "
                "VARCHAR(20) DEFAULT 'exclusive'"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS purchase_tax_mode "
                "VARCHAR(20) DEFAULT 'exclusive'"
            )
        )
        await conn.execute(
            text(
                "UPDATE company_profile SET sale_tax_mode = 'inclusive' "
                "WHERE sale_tax_mode IS NULL OR sale_tax_mode = ''"
            )
        )
        await conn.execute(
            text(
                "UPDATE company_profile SET wholesale_tax_mode = 'exclusive' "
                "WHERE wholesale_tax_mode IS NULL OR wholesale_tax_mode = ''"
            )
        )
        await conn.execute(
            text(
                "UPDATE company_profile SET purchase_tax_mode = 'exclusive' "
                "WHERE purchase_tax_mode IS NULL OR purchase_tax_mode = ''"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS sale_rate_source "
                "VARCHAR(20) DEFAULT 'product_master'"
            )
        )
        await conn.execute(
            text(
                "UPDATE company_profile SET sale_rate_source = 'product_master' "
                "WHERE sale_rate_source IS NULL OR sale_rate_source = ''"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS allow_negative_stock "
                "BOOLEAN DEFAULT TRUE"
            )
        )
        await conn.execute(
            text(
                "UPDATE company_profile SET allow_negative_stock = TRUE "
                "WHERE allow_negative_stock IS NULL"
            )
        )
        await conn.execute(
            text("ALTER TABLE products ADD COLUMN IF NOT EXISTS own_barcode BOOLEAN DEFAULT FALSE")
        )
        await conn.execute(
            text("ALTER TABLE product_barcodes ADD COLUMN IF NOT EXISTS mrp NUMERIC(14, 2)")
        )
        await conn.execute(
            text(
                "ALTER TABLE product_barcodes ADD COLUMN IF NOT EXISTS kind "
                "VARCHAR(20) DEFAULT 'company'"
            )
        )
        await conn.execute(
            text(
                "UPDATE product_barcodes SET kind = 'company' "
                "WHERE kind IS NULL OR kind = ''"
            )
        )

        # Party billing / shipping / photo
        await conn.execute(text("ALTER TABLE parties ALTER COLUMN party_type TYPE VARCHAR(20)"))
        for col, ddl in (
            ("address_line3", "VARCHAR(200)"),
            ("address_line4", "VARCHAR(200)"),
            ("shipping_address_line1", "VARCHAR(200)"),
            ("shipping_address_line2", "VARCHAR(200)"),
            ("shipping_address_line3", "VARCHAR(200)"),
            ("shipping_address_line4", "VARCHAR(200)"),
            ("shipping_city", "VARCHAR(100)"),
            ("shipping_state", "VARCHAR(100)"),
            ("shipping_pin_code", "VARCHAR(20)"),
            ("image_path", "VARCHAR(300)"),
        ):
            await conn.execute(text(f"ALTER TABLE parties ADD COLUMN IF NOT EXISTS {col} {ddl}"))
        await conn.execute(
            text("ALTER TABLE parties ADD COLUMN IF NOT EXISTS same_as_billing BOOLEAN DEFAULT TRUE")
        )
        await conn.execute(
            text("UPDATE parties SET same_as_billing = TRUE WHERE same_as_billing IS NULL")
        )
        await conn.execute(
            text(
                "ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS purchase_bill_parking "
                "BOOLEAN DEFAULT FALSE"
            )
        )
        await conn.execute(
            text(
                "UPDATE company_profile SET purchase_bill_parking = FALSE "
                "WHERE purchase_bill_parking IS NULL"
            )
        )
        await conn.execute(
            text("ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS logo_path VARCHAR(300)")
        )
        await conn.execute(
            text("ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS package_menu_codes JSONB")
        )
        await conn.execute(
            text(
                "ALTER TABLE products ADD COLUMN IF NOT EXISTS max_discount_pct "
                "NUMERIC(6, 2) DEFAULT 0"
            )
        )
        await conn.execute(
            text("UPDATE products SET max_discount_pct = 0 WHERE max_discount_pct IS NULL")
        )
        await conn.execute(
            text("ALTER TABLE products ADD COLUMN IF NOT EXISTS moq NUMERIC(14, 3) DEFAULT 0")
        )
        await conn.execute(text("UPDATE products SET moq = 0 WHERE moq IS NULL"))
        # Excel percent cells store 20% as 0.2 — scale leftover fractions to percent.
        await conn.execute(
            text(
                "UPDATE products SET max_discount_pct = ROUND(max_discount_pct * 100, 2) "
                "WHERE max_discount_pct > 0 AND max_discount_pct < 1"
            )
        )
        await conn.execute(
            text("ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS is_parked BOOLEAN DEFAULT FALSE")
        )
        await conn.execute(
            text("UPDATE vouchers SET is_parked = FALSE WHERE is_parked IS NULL")
        )
        await conn.execute(
            text("ALTER TABLE voucher_items ADD COLUMN IF NOT EXISTS mrp NUMERIC(14, 2) DEFAULT 0")
        )
        await conn.execute(
            text(
                "ALTER TABLE voucher_items ADD COLUMN IF NOT EXISTS sale_price "
                "NUMERIC(14, 2) DEFAULT 0"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE voucher_items ADD COLUMN IF NOT EXISTS profit_pct "
                "NUMERIC(8, 2) DEFAULT 0"
            )
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.reports_output_dir.mkdir(parents=True, exist_ok=True)
    settings.product_images_dir.mkdir(parents=True, exist_ok=True)
    settings.party_images_dir.mkdir(parents=True, exist_ok=True)
    settings.shop_banners_dir.mkdir(parents=True, exist_ok=True)
    settings.company_logo_dir.mkdir(parents=True, exist_ok=True)
    try:
        await ensure_database_exists(str(settings.database_url))
        await _create_tables()
        if settings.seed_on_startup:
            async with AsyncSessionLocal() as session:
                await seed_initial_data(session)
                await session.commit()
            logger.info("Database connected and seed data ready.")
        else:
            logger.info("Startup seed skipped (SEED_ON_STARTUP=false).")
    except Exception as exc:
        logger.error(
            "Database startup failed: %s. "
            "Start PostgreSQL and check DATABASE_URL in config\\generp.env",
            exc,
        )
        raise
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    app.add_middleware(AuditTrailMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(IntegrityError)
    async def _integrity_error_handler(_request: Request, exc: IntegrityError):
        detail = "This record conflicts with an existing one (duplicate code or value)."
        if "foreign key" in str(exc.orig).lower():
            detail = "Cannot complete: this record is referenced by other data."
        return JSONResponse(status_code=400, content={"detail": detail})

    app.include_router(api_router, prefix=settings.api_v1_prefix)

    settings.product_images_dir.mkdir(parents=True, exist_ok=True)
    settings.party_images_dir.mkdir(parents=True, exist_ok=True)
    settings.shop_banners_dir.mkdir(parents=True, exist_ok=True)
    settings.company_logo_dir.mkdir(parents=True, exist_ok=True)
    app.mount(
        "/media/products",
        StaticFiles(directory=str(settings.product_images_dir)),
        name="product_images",
    )
    app.mount(
        "/media/parties",
        StaticFiles(directory=str(settings.party_images_dir)),
        name="party_images",
    )
    app.mount(
        "/media/shop-banners",
        StaticFiles(directory=str(settings.shop_banners_dir)),
        name="shop_banners",
    )
    app.mount(
        "/media/company-logo",
        StaticFiles(directory=str(settings.company_logo_dir)),
        name="company_logo",
    )

    @app.get("/health", tags=["health"])
    async def health_check():
        return {"status": "ok", "service": "generp-backend"}

    _mount_web_spa(app)

    return app


def _mount_web_spa(app: FastAPI) -> None:
    """Serve the same Vite React UI from the packaged backend (PostgreSQL stays external)."""
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
