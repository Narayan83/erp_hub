"""Bootstrap admin, menus, company, ledgers from product config + module menu defs."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from erp_core.models.auth import Menu, Role, RoleMenuPermission, User, UserRoleMapping, UserType
from erp_core.models.masters import CompanyProfile, Ledger, PaymentMode, PrintConfig
from erp_core.product_config import (
    enabled_modules,
    get_product_name,
    load_module_menus,
    load_product_config,
    module_enabled,
    stock_admin_full_names,
)
from erp_core.security import get_password_hash
from erp_core.services.menu import SUPER_ADMIN_ROLE


# Platform menus seeded for every product (including new ones with menu_mode=extend).
# Print Master + Bill Template Designer use shared core APIs/pages so per-PC printers
# and designed layouts work without product-specific code.
CORE_MENUS: list[tuple[str, str, str | None, int]] = [
    ("dashboard", "Dashboard", None, 1),
    ("accounts", "Accounts", None, 30),
    ("masters", "Masters", None, 40),
    ("user_management", "User Management", None, 100),
    ("company_profile", "Company Profile", "masters", 1),
    ("party_master", "Party Master", "masters", 2),
    ("print_master", "Print Master", "masters", 3),
    ("print_template_designer", "Bill Template Designer", "masters", 4),
    ("payment_mode_creation", "Payment Modes", "masters", 5),
    ("ledger_master", "Ledger Master", "accounts", 1),
    ("advance_collection", "Advance Collection", "accounts", 2),
    ("adjustment_entry", "Payment / Adjustment", "accounts", 3),
    ("receipt_voucher_adjustment_entry", "Contra Entry", "accounts", 4),
    ("daybook", "Daybook", "accounts", 5),
    ("balance_sheet", "Balance Sheet", "accounts", 6),
    ("user_addition_modification", "Users", "user_management", 1),
]


def _apply_labels(code: str, label: str, labels: dict) -> str:
    if code == "party_master":
        return f"{labels.get('party', 'Party')} Master"
    if code == "company_profile":
        return f"{labels.get('company', 'Company')} Profile"
    if code == "advance_collection":
        return f"{labels.get('deposit', 'Deposit')} / Advance"
    return label


def _wanted_menus(cfg: dict, labels: dict) -> dict[str, tuple[str, str | None, int, str]]:
    """Menus for this product only.

    menu_mode "complete" (GenERP): the product menu file is the whole tree.
    menu_mode "extend" (default): shared core menus plus that module's extras.
    A code owned by core stays module=core so every product can show it.
    """
    core_codes = {code for code, *_rest in CORE_MENUS}
    mode = str(cfg.get("menu_mode") or "extend")
    sources: list[tuple[str, list]] = []
    if mode != "complete":
        sources.append(("core", list(CORE_MENUS)))
    for name in enabled_modules():
        if name == "core":
            continue
        sources.append((name, load_module_menus(name)))

    wanted: dict[str, tuple[str, str | None, int, str]] = {}
    for module_name, rows in sources:
        for code, label, parent_code, sort_order in rows:
            module = "core" if code in core_codes else module_name
            if code in wanted and wanted[code][3] == "core" and module != "core":
                continue
            shown = label if mode == "complete" else _apply_labels(code, label, labels)
            wanted[code] = (shown, parent_code, int(sort_order), module)
    return wanted


async def seed_initial_data(session: AsyncSession) -> None:
    cfg = load_product_config()
    labels = cfg.get("labels") or {}
    product = get_product_name()
    wanted = _wanted_menus(cfg, labels)

    code_to_id: dict[str, str] = {}
    existing_by_code: dict[str, Menu] = {}
    existing = (await session.execute(select(Menu))).scalars().all()
    for m in existing:
        code_to_id[m.code] = m.id
        existing_by_code[m.code] = m

    # Create missing menus (two passes so parents exist first)
    for _ in range(2):
        for code, (label, parent_code, sort_order, module) in wanted.items():
            if code in code_to_id:
                continue
            parent_id = code_to_id.get(parent_code) if parent_code else None
            if parent_code and parent_id is None:
                continue
            menu = Menu(
                code=code,
                label=label,
                parent_id=parent_id,
                sort_order=sort_order,
                module=module,
                is_active=True,
            )
            session.add(menu)
            await session.flush()
            code_to_id[code] = menu.id
            existing_by_code[code] = menu

    for code, (label, parent_code, sort_order, module) in wanted.items():
        menu = existing_by_code.get(code)
        if menu is None:
            continue
        menu.label = label
        menu.sort_order = sort_order
        menu.module = module
        menu.is_active = True
        menu.parent_id = code_to_id.get(parent_code) if parent_code else None

    # Other products' menus stay in the shared database but must not appear here.
    # sso_* / sbt_* are created from Single Service OPD and Short Bill setup.
    for menu in existing_by_code.values():
        if menu.code in wanted:
            continue
        if menu.module == product and (menu.code or "").startswith(("sso_", "sbt_")):
            continue
        menu.is_active = False

    # User type + Super Admin
    ut = (await session.execute(select(UserType).where(UserType.code == "admin"))).scalar_one_or_none()
    if not ut:
        ut = UserType(code="admin", name="Admin", sort_order=1)
        session.add(ut)
        await session.flush()

    role = (
        await session.execute(select(Role).where(Role.role_name == SUPER_ADMIN_ROLE))
    ).scalar_one_or_none()
    if not role:
        role = Role(role_name=SUPER_ADMIN_ROLE, description="Full access")
        session.add(role)
        await session.flush()

    # Grant all menus to Super Admin
    for menu_id in code_to_id.values():
        exists = (
            await session.execute(
                select(RoleMenuPermission).where(
                    RoleMenuPermission.role_id == role.id,
                    RoleMenuPermission.menu_id == menu_id,
                )
            )
        ).scalar_one_or_none()
        if not exists:
            session.add(
                RoleMenuPermission(
                    role_id=role.id,
                    menu_id=menu_id,
                    can_view=True,
                    can_create=True,
                    can_update=True,
                    can_delete=True,
                )
            )

    admin_cfg = cfg.get("default_admin") or {}
    email = str(admin_cfg.get("email") or f"admin@{product}.example.com").lower()
    username = str(admin_cfg.get("username") or product).strip().lower() or product
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user:
        # Migrate early seed emails (.local / .test) rejected by strict validators
        legacy = None
        for old in (f"admin@{product}.local", f"admin@{product}.test"):
            legacy = (
                await session.execute(select(User).where(User.email == old))
            ).scalar_one_or_none()
            if legacy:
                break
        if legacy:
            legacy.email = email
            user = legacy
        else:
            # Hospital and GenERP/Lodge share one database. Username is unique, and
            # every product used to insert "admin", which aborted startup on switch.
            taken = (
                await session.execute(select(User).where(User.username == username))
            ).scalar_one_or_none()
            if taken is not None and username != product:
                username = product
                taken = (
                    await session.execute(select(User).where(func.lower(User.username) == username))
                ).scalar_one_or_none()
            if taken is not None:
                user = taken
            else:
                user = User(
                    email=email,
                    username=username,
                    hashed_password=get_password_hash(str(admin_cfg.get("password") or "admin123")),
                    full_name=str(admin_cfg.get("full_name") or "Admin"),
                    user_type_id=ut.id,
                )
                session.add(user)
                await session.flush()
    # Keep the seeded admin username equal to this product (hospital, generp, …).
    if user is not None and (user.username or "").lower() != username:
        taken = (
            await session.execute(
                select(User).where(func.lower(User.username) == username, User.id != user.id)
            )
        ).scalar_one_or_none()
        if taken is None:
            user.username = username
    # Stock names from another product ("Kramcop Admin") must not linger on this admin.
    expected_name = str(admin_cfg.get("full_name") or "Admin")
    if (
        user is not None
        and user.full_name in stock_admin_full_names()
        and user.full_name != expected_name
    ):
        user.full_name = expected_name
    # Ensure role mapping exists (e.g. after email rename).
    # Use .first() — older DBs may already have duplicate (user_id, role_id) rows.
    mapped = (
        await session.execute(
            select(UserRoleMapping).where(
                UserRoleMapping.user_id == user.id, UserRoleMapping.role_id == role.id
            )
        )
    ).scalars().first()
    if not mapped:
        session.add(UserRoleMapping(user_id=user.id, role_id=role.id, priority=1))

    company = (
        await session.execute(select(CompanyProfile).where(CompanyProfile.code == "MAIN"))
    ).scalar_one_or_none()
    display = str(cfg.get("display_name") or product.title())
    # Untouched defaults from another product ("Hospital ERP") must not linger after a switch.
    stock_names = {"Hospital ERP", "GenERP", "Lodge ERP", "Kramcop", "Contract Farming"}
    if not company:
        session.add(CompanyProfile(code="MAIN", name=display))
    elif company.name in stock_names and company.name != display:
        company.name = display

    # Ledgers
    for idx, row in enumerate(cfg.get("seed_ledgers") or []):
        sk = row.get("system_key")
        existing_l = None
        if sk:
            existing_l = (
                await session.execute(select(Ledger).where(Ledger.system_key == sk))
            ).scalar_one_or_none()
        if existing_l:
            continue
        code = str(row.get("code") or idx + 1)
        by_code = (
            await session.execute(select(Ledger).where(Ledger.code == code))
        ).scalar_one_or_none()
        if by_code:
            continue
        session.add(
            Ledger(
                code=code,
                system_key=sk,
                name=str(row["name"]),
                group_name=str(row.get("group_name") or "General"),
                ledger_type=str(row.get("ledger_type") or "ASSET"),
                is_cash=bool(row.get("is_cash")),
                is_bank=bool(row.get("is_bank")),
                is_party_deposit=bool(row.get("is_party_deposit")),
                sort_order=idx,
            )
        )

    await session.flush()
    cash = (
        await session.execute(select(Ledger).where(Ledger.system_key == "CASH"))
    ).scalar_one_or_none()
    pm = (await session.execute(select(PaymentMode).where(PaymentMode.code == "CASH"))).scalar_one_or_none()
    any_mode = (await session.execute(select(PaymentMode.id).limit(1))).first()
    # Don't add a second cash mode when this hospital already uses its own codes.
    if not pm and any_mode is None:
        session.add(
            PaymentMode(
                code="CASH",
                name="Cash",
                is_cash=True,
                ledger_id=cash.id if cash else None,
                sort_order=1,
            )
        )

    if not (
        await session.execute(
            select(PrintConfig).where(
                PrintConfig.product == product, PrintConfig.code == "DEFAULT"
            )
        )
    ).scalar_one_or_none():
        session.add(
            PrintConfig(product=product, code="DEFAULT", name="Default A4", paper_size="A4")
        )

    # autoflush is off, so product seeds must see rows queued above (payment modes, ledgers).
    await session.flush()

    if module_enabled("hospital"):
        from modules.hospital.hms.seeds.bootstrap import seed_hospital_domain

        await seed_hospital_domain(session)

    if module_enabled("generp"):
        from modules.generp.seed import seed_generp_domain

        await seed_generp_domain(session)

    if module_enabled("kramcop"):
        from modules.kramcop.seed import seed_kramcop_domain

        await seed_kramcop_domain(session)

    if module_enabled("contract_farming"):
        from modules.contract_farming.seed import seed_contract_farming_domain

        await seed_contract_farming_domain(session)

    await session.commit()
