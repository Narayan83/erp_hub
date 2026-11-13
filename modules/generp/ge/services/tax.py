"""GST line calculation: amount slabs plus inclusive / exclusive rates."""

from __future__ import annotations

from typing import Any


def round2(n: float) -> float:
    return round(float(n or 0) + 1e-12, 2)


def gst_pct_candidates(raw: object) -> list[float]:
    """GST percents from Excel/CSV: 18, 18%, and Excel percent 0.18 all mean 18."""
    if raw is None:
        return []
    if isinstance(raw, bool):
        return []
    if isinstance(raw, (int, float)):
        n = float(raw)
    else:
        text = str(raw).strip().replace("%", "").replace(",", "")
        if not text:
            return []
        try:
            n = float(text)
        except ValueError:
            return []
    out = [n]
    if 0 < n < 1:
        out.append(n * 100.0)
    return out


def import_percent(raw: object, *, max_value: float = 100.0) -> float:
    """Excel 20% may arrive as 0.2; 20 and '20%' stay 20."""
    cands = gst_pct_candidates(raw)
    if not cands:
        return 0.0
    for n in cands:
        if 1 <= n <= max_value:
            return round(n, 2)
    n = cands[0]
    if 0 < n < 1:
        return round(min(n * 100.0, max_value), 2)
    return round(max(0.0, min(max_value, n)), 2)


def normalize_slabs(raw: Any) -> list[dict]:
    if not raw:
        return []
    if isinstance(raw, str):
        import json

        try:
            raw = json.loads(raw)
        except Exception:
            return []
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            min_amount = float(item.get("min_amount") or 0)
            rate = float(item.get("rate") or 0)
        except (TypeError, ValueError):
            continue
        gst_id = item.get("gst_id") or None
        if gst_id == "":
            gst_id = None
        out.append({"min_amount": min_amount, "rate": rate, "gst_id": gst_id})
    out.sort(key=lambda s: s["min_amount"])
    return out


def resolve_slab(slabs: list[dict], amount: float) -> dict | None:
    chosen: dict | None = None
    for slab in slabs:
        if float(amount or 0) + 1e-9 >= float(slab["min_amount"]):
            chosen = slab
    return chosen


def _profile_mode(profile: Any, field: str, default: str) -> str:
    if profile is None:
        val = default
    elif isinstance(profile, dict):
        val = profile.get(field) or default
    else:
        val = getattr(profile, field, None) or default
    return str(val).strip().lower()


def tax_inclusive_for(voucher_type: str, profile: Any) -> bool:
    vtype = (voucher_type or "").upper()
    if vtype in ("SALE", "SHOP_SALE", "SALE_RETURN"):
        return _profile_mode(profile, "sale_tax_mode", "inclusive") == "inclusive"
    if vtype == "WHOLESALE":
        return _profile_mode(profile, "wholesale_tax_mode", "exclusive") == "inclusive"
    if vtype in ("PURCHASE", "PURCHASE_RETURN"):
        return _profile_mode(profile, "purchase_tax_mode", "exclusive") == "inclusive"
    return False


def compute_line_amounts(
    *,
    qty: float,
    rate: float,
    discount_amount: float = 0,
    gst_rate: float = 0,
    inclusive: bool = False,
) -> tuple[float, float, float]:
    """Return (taxable, gst_amount, line amount)."""
    qty = float(qty or 0)
    rate = float(rate or 0)
    disc = float(discount_amount or 0)
    gst_rate = float(gst_rate or 0)
    net = qty * rate - disc
    if net < 0:
        net = 0.0
    if inclusive and gst_rate > 0:
        taxable = round2(net / (1.0 + gst_rate / 100.0))
        gst_amount = round2(net - taxable)
        amount = round2(net)
    else:
        taxable = round2(net)
        gst_amount = round2(taxable * gst_rate / 100.0)
        amount = round2(taxable + gst_amount)
    return taxable, gst_amount, amount
