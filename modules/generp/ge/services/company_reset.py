"""Wipe transactional / catalog data so the install can be handed to a new company.

Keeps users, roles, menus, system ledgers, payment modes, GST rates, print
setup, bill-number rules, and the main branch. Party-owned ledgers go with
the parties.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from sqlalchemy import delete, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.config import get_settings
from modules.generp.ge.models.masters import CompanyProfile, Ledger, Party, PaymentMode, SaleEntryConfig
from modules.generp.ge.models.transactions import DocumentSequence
from modules.generp.ge.services.product_import import ensure_default_categories
from modules.generp.ge.services.stock_posting import ensure_main_branch

CUSTOMER_TABLES = (
    "voucher_items",
    "voucher_payments",
    "voucher_entries",
    "vouchers",
    "cashbook_voucher_lines",
    "cashbook_vouchers",
    "order_items",
    "orders",
    "stock_movements",
    "stock_voucher_items",
    "stock_vouchers",
    "stock_lots",
    "product_barcodes",
    "product_images",
    "discount_schemes",
    "products",
    "sub_categories",
    "categories",
    "shop_banners",
    "parties",
    "audit_logs",
)


def _empty_dir(path: Path) -> None:
    if not path.exists() or not path.is_dir():
        return
    for child in path.iterdir():
        try:
            if child.is_file() or child.is_symlink():
                child.unlink(missing_ok=True)
            elif child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
        except OSError:
            pass


async def reset_company_data(session: AsyncSession) -> None:
    party_ledger_ids = [
        lid
        for lid in (
            await session.execute(select(Party.ledger_id).where(Party.ledger_id.is_not(None)))
        ).scalars().all()
        if lid
    ]

    quoted = ", ".join(CUSTOMER_TABLES)
    await session.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY"))
    session.expire_all()

    if party_ledger_ids:
        pm_ids = {
            lid
            for lid in (
                await session.execute(
                    select(PaymentMode.ledger_id).where(PaymentMode.ledger_id.is_not(None))
                )
            ).scalars().all()
            if lid
        }
        drop_ids = [lid for lid in party_ledger_ids if lid not in pm_ids]
        if drop_ids:
            await session.execute(
                delete(Ledger).where(Ledger.id.in_(drop_ids), Ledger.system_key.is_(None))
            )

    await session.execute(update(Ledger).values(opening_balance=0))
    await session.execute(update(DocumentSequence).values(last_number=0))

    profile = (
        await session.execute(select(CompanyProfile).where(CompanyProfile.code == "MAIN"))
    ).scalar_one_or_none()
    if profile is None:
        profile = CompanyProfile(code="MAIN", name="GenERP Company")
        session.add(profile)
    else:
        profile.name = "GenERP Company"
    profile.address_line1 = None
    profile.address_line2 = None
    profile.address_line3 = None
    profile.address_line4 = None
    profile.city = None
    profile.state = None
    profile.pin_code = None
    profile.phone = None
    profile.mobile = None
    profile.email = None
    profile.website = None
    profile.gstin = None
    profile.software_id = None
    profile.sale_tax_mode = "inclusive"
    profile.wholesale_tax_mode = "exclusive"
    profile.purchase_tax_mode = "exclusive"
    profile.sale_rate_source = "product_master"
    profile.allow_negative_stock = True
    profile.purchase_bill_parking = False
    profile.logo_path = None

    cfg = (
        await session.execute(select(SaleEntryConfig).where(SaleEntryConfig.code == "MAIN"))
    ).scalar_one_or_none()
    if cfg is not None:
        cfg.allow_negative_stock = True

    await ensure_main_branch(session)
    await ensure_default_categories(session)
    await session.flush()

    settings = get_settings()
    _empty_dir(settings.product_images_dir)
    _empty_dir(settings.party_images_dir)
    _empty_dir(settings.shop_banners_dir)
    _empty_dir(settings.company_logo_dir)
    _empty_dir(settings.reports_output_dir)
