"""Product code / internal barcode helpers.

Internal barcode is always 6 zero-padded digits of the numeric product code
(e.g. code 1 → 000001). Caps catalog size at 999999 products.

Own (shop-printed) barcode is Code128: 6-digit product key + MRP in rupees.
Example: product 19, MRP ₹250 → 000019000250.
"""

from __future__ import annotations

from sqlalchemy import cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.types import Integer

from modules.generp.ge.models.masters import Product

BARCODE_WIDTH = 6
PRICE_WIDTH = 6
MAX_PRODUCT_CODE = 10**BARCODE_WIDTH - 1  # 999999
OWN_BARCODE_MIN_LEN = BARCODE_WIDTH + PRICE_WIDTH  # 12


def format_internal_barcode(code: str | int) -> str:
    n = int(str(code).strip())
    if n < 1 or n > MAX_PRODUCT_CODE:
        raise ValueError(f"Product code must be 1..{MAX_PRODUCT_CODE}")
    return str(n).zfill(BARCODE_WIDTH)


def encode_own_barcode(code: str | int, mrp: float) -> str:
    """12+ digit shop barcode: product key + MRP in whole rupees."""
    prefix = format_internal_barcode(code)
    rupees = int(round(float(mrp)))
    if rupees < 0:
        raise ValueError("MRP cannot be negative")
    suffix = str(rupees).zfill(PRICE_WIDTH)
    return prefix + suffix


def parse_own_barcode(raw: str) -> tuple[str, float] | None:
    """Return (product_code, mrp) if `raw` looks like an own barcode, else None."""
    digits = (raw or "").strip()
    if not digits.isdigit() or len(digits) < OWN_BARCODE_MIN_LEN:
        return None
    prefix, rest = digits[:BARCODE_WIDTH], digits[BARCODE_WIDTH:]
    try:
        format_internal_barcode(prefix)
    except ValueError:
        return None
    return str(int(prefix)), float(int(rest))


def normalize_lookup(value: str) -> str:
    return value.strip()


def parse_product_code(raw: str | int | float | None) -> str | None:
    """Normalize a user/Excel code. Blank → None. Invalid → ValueError."""
    if raw is None:
        return None
    if isinstance(raw, float):
        if not raw.is_integer():
            raise ValueError("Product code must be a positive integer")
        raw = int(raw)
    if isinstance(raw, int):
        text = str(raw)
    else:
        text = str(raw).strip()
        if not text:
            return None
        if text.endswith(".0") and text[:-2].lstrip("+-").isdigit():
            text = text[:-2]
    if text.startswith("+"):
        text = text[1:]
    if not text.isdigit():
        raise ValueError("Product code must be a positive integer")
    n = int(text)
    if n < 1 or n > MAX_PRODUCT_CODE:
        raise ValueError(f"Product code must be 1..{MAX_PRODUCT_CODE}")
    return str(n)


def allocate_import_codes(
    explicit: list[str | None],
    *,
    db_max: int = 0,
    taken: set[str] | None = None,
    row_numbers: list[int] | None = None,
) -> tuple[list[str | None], list[str]]:
    """Assign codes for a batch. None in `explicit` means auto-increment.

    Explicit codes in the file are kept. Blank rows take max(db, file) + 1
    (e.g. 2001, 2002, 2003, blank → 2004). Duplicates are skipped, not auto-filled.
    """
    db_codes = {str(c).strip() for c in (taken or set()) if str(c).strip()}
    reserved = set(db_codes)
    assigned: list[str | None] = [None] * len(explicit)
    errors: list[str] = []
    in_file: set[str] = set()

    def row_label(i: int) -> str:
        n = row_numbers[i] if row_numbers and i < len(row_numbers) else i + 1
        return f"Row {n}"

    for i, code in enumerate(explicit):
        if code is None:
            continue
        if code in db_codes:
            errors.append(
                f"{row_label(i)}: product code {code} already exists in Product Master "
                "(this is the product code, not the table id)"
            )
            continue
        if code in in_file:
            errors.append(
                f"{row_label(i)}: product code {code} is duplicated in this file"
            )
            continue
        in_file.add(code)
        reserved.add(code)
        assigned[i] = code

    numeric_reserved = [int(c) for c in reserved if c.isdigit()]
    current = max([int(db_max or 0), *numeric_reserved] or [0])

    for i, code in enumerate(explicit):
        if code is not None:
            continue
        current += 1
        while str(current) in reserved:
            current += 1
        if current > MAX_PRODUCT_CODE:
            errors.append(f"{row_label(i)}: product code limit {MAX_PRODUCT_CODE} reached")
            continue
        assigned[i] = str(current)
        reserved.add(str(current))

    return assigned, errors


async def max_numeric_product_code(session: AsyncSession) -> int:
    stmt = select(func.coalesce(func.max(cast(Product.code, Integer)), 0)).where(
        Product.code.op("~")(r"^\d+$")
    )
    return int((await session.execute(stmt)).scalar_one() or 0)


async def next_product_code(session: AsyncSession, *, reserved: set[str] | None = None) -> str:
    """Next auto-increment code among numeric product codes (active or not)."""
    current = await max_numeric_product_code(session)
    extra = {str(c).strip() for c in (reserved or set()) if str(c).strip().isdigit()}
    if extra:
        current = max(current, max(int(c) for c in extra))
    nxt = current + 1
    while reserved and str(nxt) in reserved:
        nxt += 1
    if nxt > MAX_PRODUCT_CODE:
        raise ValueError(f"Product code limit {MAX_PRODUCT_CODE} reached")
    return str(nxt)
