"""Shared users live in erp_core. Kramcop does not create its own users table."""

from erp_core.models.auth import User

__all__ = ["User"]
