"""Nudi / Baraha ASCII Kannada → Unicode.

Conversion engine is from Aravinda VK's ascii2unicode (GPL-3.0):
https://github.com/aravindavk/ascii2unicode
"""
from __future__ import annotations

import re
import unicodedata

from modules.kramcop.kc.services._knconverter import process_line, process_word

_KANNADA_RE = re.compile(r"[\u0C80-\u0CFF]")


def looks_like_nudi(text: str) -> bool:
    if not text or _KANNADA_RE.search(text):
        return False
    return any(ord(ch) > 127 for ch in text)


def nudi_to_unicode(text: str | None) -> str:
    if text is None:
        return ""
    raw = str(text).strip()
    if not raw:
        return ""
    if _KANNADA_RE.search(raw) and not looks_like_nudi(raw):
        return unicodedata.normalize("NFC", raw)
    converted = process_line(raw)
    return unicodedata.normalize("NFC", converted)


def nudi_word_to_unicode(word: str | None) -> str:
    if not word:
        return ""
    return unicodedata.normalize("NFC", process_word(str(word)))
