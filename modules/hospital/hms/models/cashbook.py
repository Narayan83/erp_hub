"""Hospital cashbook uses core vouchers + optional patient linkage fields."""
from erp_core.models.cashbook import CashbookVoucher, CashbookVoucherLine

__all__ = ["CashbookVoucher", "CashbookVoucherLine"]
