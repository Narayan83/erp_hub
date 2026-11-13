"""Kramcop society module: members, shares, labels. Login stays on the platform."""

from modules.kramcop.kc.api.v1.router import api_router as module_api

kramcop_api = module_api
MOUNT_PREFIX = "/kramcop"
