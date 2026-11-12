from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from modules.kramcop.kc.core.database import Base


class Member(Base):
    __tablename__ = "kc_members"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    acno: Mapped[int] = mapped_column(Integer, unique=True, index=True, nullable=False)
    shac: Mapped[str] = mapped_column(String(40), default="")
    share_no: Mapped[str] = mapped_column(String(40), default="")  # legacy; SHR NO comes from transaction rno

    first_en: Mapped[str] = mapped_column(String(120), default="")
    first_kn: Mapped[str] = mapped_column(String(200), default="")
    second_en: Mapped[str] = mapped_column(String(120), default="")
    second_kn: Mapped[str] = mapped_column(String(200), default="")
    third_en: Mapped[str] = mapped_column(String(120), default="")
    third_kn: Mapped[str] = mapped_column(String(200), default="")

    village_en: Mapped[str] = mapped_column(String(250), default="")
    village_kn: Mapped[str] = mapped_column(Text, default="")
    post_en: Mapped[str] = mapped_column(String(250), default="")
    post_kn: Mapped[str] = mapped_column(Text, default="")
    taluk_en: Mapped[str] = mapped_column(String(120), default="")
    taluk_kn: Mapped[str] = mapped_column(String(250), default="")
    dist_en: Mapped[str] = mapped_column(String(120), default="")
    dist_kn: Mapped[str] = mapped_column(String(250), default="")
    pin: Mapped[str] = mapped_column(String(12), default="")

    category: Mapped[str] = mapped_column(String(20), default="")
    sex: Mapped[str] = mapped_column(String(10), default="")
    mobile: Mapped[str] = mapped_column(String(30), default="")
    phone: Mapped[str] = mapped_column(String(50), default="")
    closed: Mapped[bool] = mapped_column(Boolean, default=False)
    share_type_code: Mapped[int] = mapped_column(Integer, default=4)
    photo_path: Mapped[str] = mapped_column(String(250), default="")
    sign_path: Mapped[str] = mapped_column(String(250), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Transaction(Base):
    __tablename__ = "kc_transactions"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    member_id: Mapped[UUID | None] = mapped_column(ForeignKey("kc_members.id"), nullable=True, index=True)
    acno: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    typ: Mapped[int | None] = mapped_column(Integer, nullable=True)
    astyp: Mapped[str] = mapped_column(String(4), default="")
    txn_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    rno: Mapped[str] = mapped_column(String(20), default="")  # share number
    amount: Mapped[float] = mapped_column(Float, default=0)
    drcr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String(30), default="other", index=True)
    narration: Mapped[str] = mapped_column(String(250), default="")
    board_meeting: Mapped[str] = mapped_column(String(80), default="")
    share_count: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
