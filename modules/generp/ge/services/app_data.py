from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from modules.generp.ge.models.auth import Role, User, UserType
from modules.generp.ge.models.masters import (
    Category,
    CompanyProfile,
    GstRate,
    Ledger,
    Party,
    PaymentMode,
    Product,
    SubCategory,
)


def _to_dict(obj, fields: list[str]) -> dict:
    out = {}
    for f in fields:
        val = getattr(obj, f, None)
        if hasattr(val, "__float__") and not isinstance(val, (int, float, bool)):
            try:
                val = float(val)
            except (TypeError, ValueError):
                pass
        out[f] = val
    return out


class AppDataService:
    """Master cache returned on login so screens load instantly."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def _all(self, model):
        result = await self.session.execute(select(model).where(model.is_active.is_(True)))
        return list(result.scalars().all())

    async def get_app_data(self, *, include_catalog: bool = True) -> dict:
        user_types = await self._all(UserType)
        roles = await self._all(Role)
        ledgers = await self._all(Ledger)
        payment_modes = await self._all(PaymentMode)
        gst_rates = await self._all(GstRate)
        categories = await self._all(Category)
        sub_categories = await self._all(SubCategory)
        products: list = []
        parties: list = []
        if include_catalog:
            products = await self._all(Product)
            result = await self.session.execute(select(Party).where(Party.is_active.is_(True)))
            parties = list(result.scalars().all())
        result = await self.session.execute(
            select(User)
            .options(selectinload(User.user_type))
            .where(User.is_active.is_(True))
        )
        users = list(result.scalars().all())
        profile = (
            await self.session.execute(select(CompanyProfile).where(CompanyProfile.code == "MAIN"))
        ).scalar_one_or_none()

        return {
            "user_types": [_to_dict(x, ["id", "code", "name", "sort_order"]) for x in user_types],
            "roles": [_to_dict(x, ["id", "role_name", "description"]) for x in roles],
            "users": [
                {
                    **_to_dict(x, ["id", "username", "email", "full_name", "phone", "user_type_id", "is_active"]),
                    "user_type_name": x.user_type.name if x.user_type else None,
                }
                for x in users
            ],
            "ledgers": [_to_dict(x, ["id", "code", "name", "group_name"]) for x in ledgers],
            "payment_modes": [
                _to_dict(x, ["id", "code", "name", "is_cash", "is_credit", "ledger_id", "sort_order"])
                for x in payment_modes
            ],
            "gst_rates": [_to_dict(x, ["id", "code", "name", "rate", "cgst", "sgst", "igst"]) for x in gst_rates],
            "categories": [_to_dict(x, ["id", "code", "name", "sort_order"]) for x in categories],
            "sub_categories": [
                _to_dict(x, ["id", "category_id", "code", "name", "sort_order"]) for x in sub_categories
            ],
            "products": [
                _to_dict(
                    x,
                    [
                        "id", "code", "barcode", "name", "category_id", "sub_category_id", "gst_id",
                        "tax_slabs", "unit", "hsn_code", "purchase_price", "sale_price", "wholesale_price",
                        "mrp", "current_stock", "own_barcode",
                    ],
                )
                for x in products
            ],
            "customers": [
                _to_dict(x, ["id", "code", "name", "phone", "gstin", "ledger_id"])
                for x in parties if x.party_type in ("customer", "both")
            ],
            "vendors": [
                _to_dict(x, ["id", "code", "name", "phone", "gstin", "ledger_id"])
                for x in parties if x.party_type in ("vendor", "both")
            ],
            "company_profile": _to_dict(
                profile,
                [
                    "id", "code", "name", "address_line1", "address_line2", "address_line3",
                    "address_line4", "city", "state", "pin_code", "phone", "mobile", "email",
                    "website", "gstin", "sale_tax_mode", "wholesale_tax_mode", "purchase_tax_mode",
                    "sale_rate_source", "allow_negative_stock", "purchase_bill_parking",
                ],
            ) if profile else {},
        }
