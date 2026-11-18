"""Stock management: branches, stock vouchers, stock movements ledger."""

from __future__ import annotations

from datetime import date
from uuid import uuid4

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from modules.generp.ge.core.database import Base
from modules.generp.ge.models.base import TimestampMixin


def _pk() -> Mapped[str]:
    return mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))


# Stock voucher_type values:
#   INWARD_DC, OUTWARD_DC, INWARD_DC_RETURN, OUTWARD_DC_RETURN,
#   SHORTAGE, EXCESS, WASTAGE, EXCHANGE,
#   CONVERSION, TRANSFER_OUT, TRANSFER_IN
STOCK_VOUCHER_TYPES = (
    "INWARD_DC",
    "OUTWARD_DC",
    "INWARD_DC_RETURN",
    "OUTWARD_DC_RETURN",
    "SHORTAGE",
    "EXCESS",
    "WASTAGE",
    "EXCHANGE",
    "CONVERSION",
    "TRANSFER_OUT",
    "TRANSFER_IN",
)

# line_role for CONVERSION / EXCHANGE
#   DEBIT  = reduce stock (source / input)
#   CREDIT = increase stock (output / pack)
#   WASTAGE = loss during process (reduce stock of source product)
LINE_ROLES = ("DEBIT", "CREDIT", "WASTAGE", "NORMAL")


class Branch(Base, TimestampMixin):
    __tablename__ = "branches"

    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_main: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class StockVoucher(Base, TimestampMixin):
    __tablename__ = "stock_vouchers"

    id: Mapped[str] = _pk()
    voucher_type: Mapped[str] = mapped_column(String(30), index=True)
    voucher_no: Mapped[str] = mapped_column(String(80), index=True)
    voucher_date: Mapped[date] = mapped_column(Date, index=True)
    branch_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("branches.id"), nullable=True, index=True
    )
    counterparty_branch_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("branches.id"), nullable=True
    )
    party_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("parties.id"), nullable=True
    )
    reference_no: Mapped[str | None] = mapped_column(String(60), nullable=True)
    narration: Mapped[str | None] = mapped_column(Text, nullable=True)
    wastage_qty: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    is_cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )

    branch: Mapped["Branch | None"] = relationship("Branch", foreign_keys=[branch_id])
    counterparty_branch: Mapped["Branch | None"] = relationship(
        "Branch", foreign_keys=[counterparty_branch_id]
    )
    items: Mapped[list["StockVoucherItem"]] = relationship(
        back_populates="voucher", cascade="all, delete-orphan"
    )


class StockVoucherItem(Base, TimestampMixin):
    __tablename__ = "stock_voucher_items"

    id: Mapped[str] = _pk()
    voucher_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("stock_vouchers.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("products.id"), index=True
    )
    # NORMAL for single-direction vouchers; DEBIT/CREDIT/WASTAGE for conversion/exchange
    line_role: Mapped[str] = mapped_column(String(20), default="NORMAL")
    quantity: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    rate: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    amount: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    narration: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lot_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    voucher: Mapped["StockVoucher"] = relationship(back_populates="items")
    product: Mapped["Product"] = relationship("Product")


class LotMaster(Base, TimestampMixin):
    """Named lot (NT 01, PU 01) chosen on purchase when lots are enabled."""

    __tablename__ = "lot_masters"

    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    remarks: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class StockBarcode(Base, TimestampMixin):
    """One inward barcode. Unique pieces have qty 1; a multi barcode holds many pieces."""

    __tablename__ = "stock_barcodes"

    id: Mapped[str] = _pk()
    barcode: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    product_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("products.id"), index=True
    )
    lot_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    voucher_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    voucher_item_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    supplier_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    inward_date: Mapped[date] = mapped_column(Date, index=True)
    qty_in: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    qty_remaining: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    cost_price: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    sale_rate: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    mrp: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    disc_pct: Mapped[float] = mapped_column(Numeric(8, 2), default=0)
    # in_stock | sold | transferred | returned
    status: Mapped[str] = mapped_column(String(20), default="in_stock", index=True)
    print_copies: Mapped[int] = mapped_column(Integer, default=1)


class StockBarcodeMove(Base, TimestampMixin):
    """Qty taken from or put back on a stock barcode. Reversed when a bill is edited."""

    __tablename__ = "stock_barcode_moves"

    id: Mapped[str] = _pk()
    stock_barcode_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("stock_barcodes.id"), index=True
    )
    qty_delta: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    reason: Mapped[str] = mapped_column(String(30), default="SALE")
    voucher_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)
    voucher_item_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    stock_voucher_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True, index=True)


class StockLot(Base, TimestampMixin):
    """Inward consignment snapshot. FIFO sale/MRP uses the oldest remaining lot."""

    __tablename__ = "stock_lots"

    id: Mapped[str] = _pk()
    product_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("products.id"), index=True
    )
    lot_date: Mapped[date] = mapped_column(Date, index=True)
    qty_in: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    qty_remaining: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    cost: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    sale_rate: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    wholesale_rate: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    mrp: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    source_type: Mapped[str] = mapped_column(String(30), default="OPENING")
    source_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)


class StockMovement(Base, TimestampMixin):
    """Immutable stock ledger. qty_delta is signed (+ in / - out)."""

    __tablename__ = "stock_movements"

    id: Mapped[str] = _pk()
    movement_date: Mapped[date] = mapped_column(Date, index=True)
    product_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("products.id"), index=True
    )
    branch_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("branches.id"), nullable=True, index=True
    )
    qty_delta: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    movement_type: Mapped[str] = mapped_column(String(30), index=True)
    trading_voucher_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("vouchers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    stock_voucher_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("stock_vouchers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    order_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("orders.id", ondelete="SET NULL"), nullable=True
    )
    ref_no: Mapped[str | None] = mapped_column(String(40), nullable=True)
    narration: Mapped[str | None] = mapped_column(String(255), nullable=True)


# Late imports for typing only
from modules.generp.ge.models.masters import Product  # noqa: E402
