from uuid import uuid4

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, Numeric, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from erp_core.database import Base
from erp_core.models.masters import (
    CompanyProfile,
    Ledger,
    Party,
    PaymentMode,
    PrintConfig,
)
from modules.generp.ge.models.base import TimestampMixin


def _pk() -> Mapped[str]:
    return mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))


class SaleEntryConfig(Base, TimestampMixin):
    """Singleton (code='MAIN'). Controls which entry fields are enabled in the Sale Bill grid."""

    __tablename__ = "sale_entry_config"

    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True, default="MAIN")
    enable_qty: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_rate: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_discount: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_mrp: Mapped[bool] = mapped_column(Boolean, default=False)
    default_qty: Mapped[float] = mapped_column(Numeric(14, 3), default=1)
    allow_negative_stock: Mapped[bool] = mapped_column(Boolean, default=True)


class GstRate(Base, TimestampMixin):
    __tablename__ = "gst_rates"

    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    rate: Mapped[float] = mapped_column(Numeric(6, 2), default=0)
    cgst: Mapped[float] = mapped_column(Numeric(6, 2), default=0)
    sgst: Mapped[float] = mapped_column(Numeric(6, 2), default=0)
    igst: Mapped[float] = mapped_column(Numeric(6, 2), default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Category(Base, TimestampMixin):
    __tablename__ = "categories"

    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class SubCategory(Base, TimestampMixin):
    __tablename__ = "sub_categories"

    id: Mapped[str] = _pk()
    category_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("categories.id", ondelete="CASCADE"), index=True
    )
    code: Mapped[str] = mapped_column(String(30), index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    category: Mapped["Category"] = relationship("Category")


class Product(Base, TimestampMixin):
    __tablename__ = "products"

    id: Mapped[str] = _pk()
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    # Internal 6-digit barcode derived from code (code 1 → 000001). Unique for scans.
    barcode: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("categories.id"), nullable=True
    )
    sub_category_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("sub_categories.id"), nullable=True
    )
    gst_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("gst_rates.id"), nullable=True
    )
    # Amount slabs: [{min_amount, rate, gst_id?}]. Highest matching min_amount wins.
    tax_slabs: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    unit: Mapped[str] = mapped_column(String(20), default="NOS")
    hsn_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # goods | service — GST: HSN for goods, SAC for services
    item_type: Mapped[str] = mapped_column(String(20), default="goods")
    purchase_price: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    sale_price: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    wholesale_price: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    mrp: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    # Ceiling: sale bill cannot sell below sale price × (1 − this % / 100). 0 = no ceiling.
    max_discount_pct: Mapped[float] = mapped_column(Numeric(6, 2), default=0)
    # Minimum order quantity. Stored on the product; not enforced on sale bill yet.
    moq: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    opening_stock: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    current_stock: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    # Relative filename under product_images_dir, e.g. "{id}.jpg"
    image_path: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Optional parent when created as a variant of another product
    parent_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("products.id"), nullable=True, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # When true, product appears in the Shopping Cart catalog
    is_in_shop: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    # Shop prints its own barcodes (product key + MRP). Off = manufacturer barcodes.
    own_barcode: Mapped[bool] = mapped_column(Boolean, default=False)

    category: Mapped["Category | None"] = relationship("Category")
    sub_category: Mapped["SubCategory | None"] = relationship("SubCategory")
    gst: Mapped["GstRate | None"] = relationship("GstRate")
    alt_barcodes: Mapped[list["ProductBarcode"]] = relationship(
        "ProductBarcode", back_populates="product", cascade="all"
    )
    images: Mapped[list["ProductImage"]] = relationship(
        "ProductImage",
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="ProductImage.sort_order",
    )
    parent: Mapped["Product | None"] = relationship(
        "Product", remote_side="Product.id", foreign_keys=[parent_id]
    )


class ProductImage(Base, TimestampMixin):
    """Gallery image for a product. One row may be marked is_primary (main)."""

    __tablename__ = "product_images"

    id: Mapped[str] = _pk()
    product_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    # Relative filename under product_images_dir
    file_path: Mapped[str] = mapped_column(String(300), nullable=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    product: Mapped["Product"] = relationship("Product", back_populates="images")


class ShopBanner(Base, TimestampMixin):
    """Storefront hero banner images for Shopping Cart."""

    __tablename__ = "shop_banners"

    id: Mapped[str] = _pk()
    title: Mapped[str] = mapped_column(String(120), default="Shop")
    file_path: Mapped[str] = mapped_column(String(300), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)


class ProductBarcode(Base, TimestampMixin):
    """Company / manufacturer barcodes (typically 12–13 chars) linked to a product."""

    __tablename__ = "product_barcodes"

    id: Mapped[str] = _pk()
    product_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    barcode: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    sale_rate: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    ws_rate: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    mrp: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    # own = shop-printed (code+MRP); company = manufacturer / EAN
    kind: Mapped[str] = mapped_column(String(20), default="company")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    product: Mapped["Product"] = relationship("Product", back_populates="alt_barcodes")


