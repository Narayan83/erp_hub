"""Normalize login identifiers: short user id and optional email."""

from __future__ import annotations


def normalize_user_ids(username: str | None, email: str | None) -> tuple[str, str]:
    """Return (username, email). Email defaults to user id; user id defaults from email local-part."""
    u = (username or "").strip().lower()
    e = (email or "").strip().lower()
    if not u and not e:
        raise ValueError("User ID is required")
    if u and not e:
        e = u
    if e and not u:
        u = e.split("@", 1)[0] if "@" in e else e
    if not u or not e:
        raise ValueError("User ID is required")
    if " " in u:
        raise ValueError("User ID cannot contain spaces")
    if len(u) > 80:
        raise ValueError("User ID is too long")
    return u, e
