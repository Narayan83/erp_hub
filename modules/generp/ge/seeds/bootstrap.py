from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.core.security import get_password_hash
from modules.generp.ge.models.auth import (
    Menu,
    Role,
    RoleMenuPermission,
    User,
    UserRoleMapping,
    UserType,
)
from modules.generp.ge.models.masters import (
    CompanyProfile,
    GstRate,
    Ledger,
    Party,
    PaymentMode,
    PrintConfig,
)
from modules.generp.ge.seeds.menu_definitions import MENU_DEFINITIONS
from modules.generp.ge.services.ledger_codes import format_ledger_code, next_code_from_used, parse_ledger_n
from modules.generp.ge.services.party_codes import CUSTOMER_TYPES, format_party_code
from modules.generp.ge.services.stock_posting import ensure_main_branch

USER_TYPES = [
    ("admin", "Admin", 1),
    ("user", "User", 2),
]

ROLES = [
    ("Super Admin", "Full system access"),
    ("Admin", "Administrator"),
    ("Billing", "Billing / counter staff"),
    ("Accounts", "Accounts department"),
]

# system_key, name, group_name, opening_balance, opening_type, ledger_type, is_cash, is_bank, is_party_deposit
# Display codes are assigned incrementally (Cash = 1).
LEDGERS = [
    ("CASH", "Cash", "Cash-in-Hand", 0, "Dr", "ASSET", True, False, False),
    ("SALES", "Sales Account", "Sales Accounts", 0, "Cr", "INCOME", False, False, False),
    ("PURCHASE", "Purchase Account", "Purchase Accounts", 0, "Dr", "EXPENSE", False, False, False),
    ("CGST_OUTPUT", "CGST Output", "Duties & Taxes", 0, "Cr", "LIABILITY", False, False, False),
    ("SGST_OUTPUT", "SGST Output", "Duties & Taxes", 0, "Cr", "LIABILITY", False, False, False),
    ("IGST_OUTPUT", "IGST Output", "Duties & Taxes", 0, "Cr", "LIABILITY", False, False, False),
    ("CGST_INPUT", "CGST Input", "Duties & Taxes", 0, "Dr", "ASSET", False, False, False),
    ("SGST_INPUT", "SGST Input", "Duties & Taxes", 0, "Dr", "ASSET", False, False, False),
    ("IGST_INPUT", "IGST Input", "Duties & Taxes", 0, "Dr", "ASSET", False, False, False),
    ("CUST-DEPOSIT", "Customer Deposit / Advance", "Current Liabilities", 0, "Cr", "LIABILITY", False, False, True),
    ("PARTY-ACCOUNT", "Party Account", "Current Liabilities", 0, "Cr", "LIABILITY", False, False, False),
    ("CAPITAL", "Capital Account", "Capital Account", 0, "Cr", "LIABILITY", False, False, False),
    ("ROUND_OFF", "Round Off", "Indirect Expenses", 0, "Dr", "EXPENSE", False, False, False),
]

# code, name, is_cash, is_credit, ledger_code, sort_order
PAYMENT_MODES = [
    ("CASH", "Cash", True, False, "CASH", 1),
    ("CARD", "Card / Swipe", False, False, "CASH", 2),
    ("UPI", "UPI / Online", False, False, "CASH", 3),
    ("CREDIT", "Credit", False, True, None, 4),
]

# code, name, rate
GST_RATES = [
    ("GST0", "GST 0%", 0),
    ("GST5", "GST 5%", 5),
    ("GST12", "GST 12%", 12),
    ("GST18", "GST 18%", 18),
    ("GST28", "GST 28%", 28),
]

PRINT_CONFIGS = [
    ("SALE_BILL", "Sale Bill"),
    ("WHOLESALE_BILL", "Wholesale Bill"),
    ("BARCODE_LABEL", "Barcode Label"),
    ("PURCHASE_BILL", "Purchase Bill"),
    ("SALES_RETURN", "Sales Return"),
    ("PURCHASE_RETURN", "Purchase Return"),
    ("LEDGER_REPORT", "Ledger Report"),
    ("DEBTORS_REPORT", "Debtors Report"),
    ("DAILY_COLLECTION_REPORT", "Daily Collection Report"),
    ("TAXWISE_BILL_SUMMARY", "Taxwise Bill Summary"),
    ("TAXWISE_SUMMARY", "Taxwise Summary"),
    ("CASH_BOOK", "Cash Book"),
    ("DAYBOOK", "Daybook"),
]


async def seed_initial_data(session: AsyncSession) -> None:
    role_map = await _seed_roles(session)
    user_type_map = await _seed_user_types(session)
    await _seed_ledgers(session)
    await _renumber_party_codes(session)
    await _seed_payment_modes(session)
    await _seed_gst(session)
    await _seed_print_configs(session)
    await _seed_company_profile(session)
    await ensure_main_branch(session)
    menu_map = await _seed_menus(session)
    await _seed_role_permissions(session, role_map, menu_map)
    await _seed_super_admin(session, role_map["Super Admin"], user_type_map["admin"])


async def _seed_user_types(session: AsyncSession) -> dict[str, str]:
    result: dict[str, str] = {}
    existing = {x.code: x for x in (await session.execute(select(UserType))).scalars().all()}
    for code, name, sort_order in USER_TYPES:
        obj = existing.get(code)
        if not obj:
            obj = UserType(code=code, name=name, sort_order=sort_order, is_active=True)
            session.add(obj)
            await session.flush()
        result[code] = obj.id
    return result


async def _seed_roles(session: AsyncSession) -> dict[str, str]:
    result: dict[str, str] = {}
    existing = {x.role_name: x for x in (await session.execute(select(Role))).scalars().all()}
    for role_name, description in ROLES:
        obj = existing.get(role_name)
        if not obj:
            obj = Role(role_name=role_name, description=description, is_active=True)
            session.add(obj)
            await session.flush()
        result[role_name] = obj.id
    return result


async def _seed_ledgers(session: AsyncSession) -> None:
    rows = list((await session.execute(select(Ledger))).scalars().all())
    by_key = {x.system_key: x for x in rows if x.system_key}
    by_code = {x.code: x for x in rows}
    by_name = {str(x.name or "").strip().lower(): x for x in rows}
    used_codes = {x.code for x in rows}

    for idx, (
        key,
        name,
        group,
        opening,
        otype,
        ledger_type,
        is_cash,
        is_bank,
        is_party_deposit,
    ) in enumerate(LEDGERS, start=1):
        obj = by_key.get(key)
        if obj is None:
            candidate = by_code.get(key) or by_name.get(name.strip().lower())
            if candidate and (not candidate.system_key or candidate.system_key == key):
                obj = candidate
        if not obj:
            code = next_code_from_used(used_codes, start=idx)
            used_codes.add(code)
            obj = Ledger(
                code=code,
                system_key=key,
                name=name,
                group_name=group,
                opening_balance=opening,
                opening_type=otype,
                ledger_type=ledger_type,
                is_cash=is_cash,
                is_bank=is_bank,
                is_party_deposit=is_party_deposit,
                sort_order=idx,
                is_active=True,
            )
            session.add(obj)
            by_key[key] = obj
            by_code[code] = obj
            by_name[name.strip().lower()] = obj
            continue

        obj.system_key = key
        obj.ledger_type = ledger_type
        obj.opening_type = otype
        obj.is_cash = is_cash
        obj.is_bank = is_bank
        obj.is_party_deposit = is_party_deposit
        obj.sort_order = idx
        obj.group_name = group
        # Old mnemonic codes (CASH, GST_OUTPUT, …) become incremental 1, 2, 3, …
        if obj.code == key:
            new_code = next_code_from_used(used_codes, start=idx)
            used_codes.discard(obj.code)
            obj.code = new_code
            used_codes.add(new_code)
            by_code[new_code] = obj
        obj.is_active = True
        by_key[key] = obj

    keep_keys = {spec[0] for spec in LEDGERS}
    for row in rows:
        if row.system_key and row.system_key not in keep_keys:
            row.is_active = False
            # Free numeric / L#### so remaining system ledgers can compact to 1, 2, 3, …
            if parse_ledger_n(row.code):
                used_codes.discard(row.code)
                row.code = f"X-{row.system_key}"[:30]
    await session.flush()

    # Compact: system ledgers 1, 2, 3, … ; migrate legacy L#### / colliding user codes after that.
    all_rows = list((await session.execute(select(Ledger))).scalars().all())
    by_key = {x.system_key: x for x in all_rows if x.system_key}
    n_sys = len(LEDGERS)
    for row in all_rows:
        if not row.is_active:
            continue
        if row.system_key in keep_keys:
            row.code = f"tmp.{row.system_key}"[:30]
            continue
        n = parse_ledger_n(row.code)
        plain = str(row.code or "").isdigit()
        if not plain or n <= n_sys:
            row.code = f"tmp.{str(row.id).replace('-', '')[:16]}"
    await session.flush()
    for idx, spec in enumerate(LEDGERS, start=1):
        obj = by_key.get(spec[0])
        if obj:
            obj.code = format_ledger_code(idx)
            obj.sort_order = idx
    await session.flush()
    used_ns = set(range(1, n_sys + 1))
    for row in all_rows:
        if row.is_active and (not row.system_key or row.system_key not in keep_keys):
            n = parse_ledger_n(row.code)
            if str(row.code or "").isdigit() and n > n_sys:
                used_ns.add(n)
    parked = [
        r
        for r in all_rows
        if r.is_active
        and (not r.system_key or r.system_key not in keep_keys)
        and str(r.code or "").startswith("tmp.")
    ]
    parked.sort(key=lambda r: (r.sort_order or 0, (r.name or "").lower(), r.id or ""))
    n = n_sys
    for row in parked:
        n += 1
        while n in used_ns:
            n += 1
        row.code = format_ledger_code(n)
        used_ns.add(n)
    await session.flush()

    cash = by_key.get("CASH")
    seeded_bank = by_key.get("BANK")
    if cash:
        modes = list((await session.execute(select(PaymentMode))).scalars().all())
        for mode in modes:
            if mode.code not in ("CARD", "UPI"):
                continue
            if not mode.ledger_id or (seeded_bank and mode.ledger_id == seeded_bank.id):
                mode.ledger_id = cash.id
    await session.flush()


async def _renumber_party_codes(session: AsyncSession) -> None:
    """Migrate CUST0001 / VEND0001 (and other non-numeric) to 1, 2, 3, … per series."""
    parties = list((await session.execute(select(Party))).scalars().all())
    if not parties:
        return
    if all(str(p.code or "").isdigit() for p in parties):
        return

    def _sort_key(p: Party) -> tuple:
        return (str(p.created_at or ""), p.name or "", p.id or "")

    to_park = [p for p in parties if not str(p.code or "").isdigit()]
    for p in to_park:
        p.code = f"tmp.{str(p.id).replace('-', '')[:16]}"
    await session.flush()

    customer_like = sorted(
        [p for p in parties if p.party_type in CUSTOMER_TYPES],
        key=_sort_key,
    )
    vendor_only = sorted(
        [p for p in parties if p.party_type == "vendor"],
        key=_sort_key,
    )

    taken_cust = {p.code for p in customer_like if str(p.code or "").isdigit()}
    n = 1
    both_codes: set[str] = set()
    for p in customer_like:
        if str(p.code or "").isdigit():
            if p.party_type == "both":
                both_codes.add(p.code)
            continue
        while format_party_code(n) in taken_cust:
            n += 1
        p.code = format_party_code(n)
        taken_cust.add(p.code)
        if p.party_type == "both":
            both_codes.add(p.code)
        n += 1
    await session.flush()

    taken_vend = {p.code for p in vendor_only if str(p.code or "").isdigit()} | both_codes
    n = 1
    for p in vendor_only:
        if str(p.code or "").isdigit():
            continue
        while format_party_code(n) in taken_vend:
            n += 1
        p.code = format_party_code(n)
        taken_vend.add(p.code)
        n += 1
    await session.flush()


async def _seed_payment_modes(session: AsyncSession) -> None:
    ledgers = list((await session.execute(select(Ledger))).scalars().all())
    by_key = {x.system_key: x for x in ledgers if x.system_key}
    by_code = {x.code: x for x in ledgers}
    existing = {x.code: x for x in (await session.execute(select(PaymentMode))).scalars().all()}
    for code, name, is_cash, is_credit, ledger_key, sort_order in PAYMENT_MODES:
        if code in existing:
            continue
        ledger = (by_key.get(ledger_key) or by_code.get(ledger_key)) if ledger_key else None
        session.add(
            PaymentMode(
                code=code,
                name=name,
                is_cash=is_cash,
                is_credit=is_credit,
                ledger_id=ledger.id if ledger else None,
                sort_order=sort_order,
                is_active=True,
            )
        )


async def _seed_gst(session: AsyncSession) -> None:
    existing = {x.code: x for x in (await session.execute(select(GstRate))).scalars().all()}
    for i, (code, name, rate) in enumerate(GST_RATES, start=1):
        if code in existing:
            continue
        session.add(
            GstRate(
                code=code,
                name=name,
                rate=rate,
                cgst=rate / 2,
                sgst=rate / 2,
                igst=rate,
                sort_order=i,
                is_active=True,
            )
        )
    await session.flush()
    await _deactivate_duplicate_gst(session)


async def _deactivate_duplicate_gst(session: AsyncSession) -> None:
    """Keep one active GST row per rate (prefer seeded GST18-style codes)."""
    rows = list(
        (await session.execute(select(GstRate).where(GstRate.is_active.is_(True)))).scalars().all()
    )
    by_rate: dict[float, list[GstRate]] = {}
    for row in rows:
        by_rate.setdefault(float(row.rate), []).append(row)
    for rate, group in by_rate.items():
        if len(group) < 2:
            continue
        prefer = f"GST{int(rate)}" if rate == int(rate) else None
        keep = next((g for g in group if prefer and g.code == prefer), None)
        if keep is None:
            keep = sorted(group, key=lambda g: (g.sort_order, g.code))[0]
        for g in group:
            if g.id != keep.id:
                g.is_active = False


async def _seed_print_configs(session: AsyncSession) -> None:
    from modules.generp.ge.reports.print_layouts import default_document_layout

    existing = {x.code: x for x in (await session.execute(select(PrintConfig))).scalars().all()}
    default_barcode_layout = default_document_layout("BARCODE_LABEL")
    for i, (code, name) in enumerate(PRINT_CONFIGS, start=1):
        if code in existing:
            obj = existing[code]
            if not obj.layout_options:
                obj.layout_options = default_document_layout(code) if code in {
                    "SALE_BILL",
                    "WHOLESALE_BILL",
                    "DAILY_COLLECTION_REPORT",
                    "BARCODE_LABEL",
                } else None
            continue
        layout_options = (
            default_document_layout(code)
            if code in {"SALE_BILL", "WHOLESALE_BILL", "DAILY_COLLECTION_REPORT", "BARCODE_LABEL"}
            else None
        )
        session.add(
            PrintConfig(
                code=code,
                name=name,
                sort_order=i,
                is_active=True,
                layout_options=layout_options,
                paper_size="CUSTOM" if code == "BARCODE_LABEL" else "A4",
            )
        )
    barcode_cfg = existing.get("BARCODE_LABEL")
    if barcode_cfg and not barcode_cfg.layout_options:
        barcode_cfg.layout_options = default_barcode_layout


async def _seed_company_profile(session: AsyncSession) -> None:
    existing = (
        await session.execute(select(CompanyProfile).where(CompanyProfile.code == "MAIN"))
    ).scalar_one_or_none()
    if not existing:
        session.add(CompanyProfile(code="MAIN", name="GenERP Company"))


async def _seed_menus(session: AsyncSession) -> dict[str, str]:
    result: dict[str, str] = {}
    defined_codes: set[str] = set()
    existing = {m.code: m for m in (await session.execute(select(Menu))).scalars().all()}

    for code, label, _parent, sort_order, mcode, form, params in MENU_DEFINITIONS:
        defined_codes.add(code)
        menu = existing.get(code)
        if not menu:
            menu = Menu(
                code=code,
                label=label,
                parent_id=None,
                sort_order=sort_order,
                legacy_mcode=mcode,
                legacy_form=form,
                parameters=params,
                is_active=True,
            )
            session.add(menu)
            await session.flush()
            existing[code] = menu
        result[code] = menu.id

    for code, label, parent_code, sort_order, mcode, form, params in MENU_DEFINITIONS:
        menu = existing[code]
        menu.label = label
        menu.parent_id = result.get(parent_code) if parent_code else None
        menu.sort_order = sort_order
        menu.legacy_mcode = mcode
        menu.legacy_form = form
        menu.parameters = params
        menu.is_active = True

    for menu in existing.values():
        if menu.code not in defined_codes and menu.is_active:
            menu.is_active = False
    return result


async def _seed_role_permissions(
    session: AsyncSession, role_map: dict[str, str], menu_map: dict[str, str]
) -> None:
    super_admin_id = role_map["Super Admin"]
    existing = set(
        (
            await session.execute(
                select(RoleMenuPermission.menu_id).where(
                    RoleMenuPermission.role_id == super_admin_id
                )
            )
        ).scalars().all()
    )
    for menu_id in menu_map.values():
        if menu_id in existing:
            continue
        session.add(
            RoleMenuPermission(
                role_id=super_admin_id,
                menu_id=menu_id,
                can_view=True,
                can_create=True,
                can_update=True,
                can_delete=True,
            )
        )


async def _seed_super_admin(
    session: AsyncSession, super_admin_role_id: str, admin_user_type_id: str
) -> None:
    email = "admin@admin.com"
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user:
        user = User(
            email=email,
            username="admin",
            hashed_password=get_password_hash("admin123"),
            full_name="Super Admin",
            phone="0000000000",
            user_type_id=admin_user_type_id,
            is_active=True,
        )
        session.add(user)
        await session.flush()
    else:
        if user.user_type_id != admin_user_type_id:
            user.user_type_id = admin_user_type_id
        if not user.username:
            user.username = "admin"

    mapping = (
        await session.execute(
            select(UserRoleMapping).where(
                UserRoleMapping.user_id == user.id,
                UserRoleMapping.role_id == super_admin_role_id,
            )
        )
    ).scalar_one_or_none()
    if not mapping:
        session.add(UserRoleMapping(user_id=user.id, role_id=super_admin_role_id, priority=1))
