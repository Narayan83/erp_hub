from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from erp_core.database import Base


class CfProject(Base):
    __tablename__ = "cf_projects"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    address: Mapped[str] = mapped_column(Text, default="")
    location_id: Mapped[UUID | None] = mapped_column(ForeignKey("cf_locations.id"), nullable=True)
    description: Mapped[str] = mapped_column(Text, default="")
    start_date: Mapped[str] = mapped_column(String(20), default="")
    end_date: Mapped[str] = mapped_column(String(20), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    partners: Mapped[list["CfProjectPartner"]] = relationship(
        "CfProjectPartner", cascade="all, delete-orphan", lazy="selectin"
    )


class CfProjectPartner(Base):
    __tablename__ = "cf_project_partners"
    __table_args__ = (UniqueConstraint("project_id", "partner_id", name="uq_cf_project_partner"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(ForeignKey("cf_projects.id", ondelete="CASCADE"), nullable=False)
    partner_id: Mapped[UUID] = mapped_column(ForeignKey("cf_partners.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
