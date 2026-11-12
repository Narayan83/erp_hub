"""Shim: print-config API now lives in erp_core.api.endpoints.print_configs."""

from erp_core.api.endpoints.print_configs import router

__all__ = ["router"]
