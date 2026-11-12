"""Shared cashbook tables live in erp_core."""

from erp_core.models.cashbook import CashbookVoucher, CashbookVoucherLine

__all__ = ["CashbookVoucher", "CashbookVoucherLine"]
