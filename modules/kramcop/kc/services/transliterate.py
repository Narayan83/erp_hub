"""English phonetic → Kannada Unicode (not translation)."""
from __future__ import annotations

import re
import unicodedata

# Longest-first consonant and vowel tokens (Baraha / common IME style).
_CONSONANTS: list[tuple[str, str]] = [
    ("ksh", "ಕ್ಷ"),
    ("jny", "ಜ್ಞ"),
    ("jn", "ಜ್ಞ"),
    ("kh", "ಖ"),
    ("gh", "ಘ"),
    ("chh", "ಛ"),
    ("Ch", "ಛ"),
    ("ch", "ಚ"),
    ("jh", "ಝ"),
    ("th", "ಥ"),
    ("dh", "ಧ"),
    ("ph", "ಫ"),
    ("bh", "ಭ"),
    ("sh", "ಶ"),
    ("Sh", "ಷ"),
    ("Th", "ಠ"),
    ("Dh", "ಢ"),
    ("Ng", "ಙ"),
    ("ny", "ಞ"),
    ("ng", "ಙ"),
    ("k", "ಕ"),
    ("g", "ಗ"),
    ("c", "ಚ"),
    ("j", "ಜ"),
    ("T", "ಟ"),
    ("D", "ಡ"),
    ("N", "ಣ"),
    ("t", "ತ"),
    ("d", "ದ"),
    ("n", "ನ"),
    ("p", "ಪ"),
    ("b", "ಬ"),
    ("m", "ಮ"),
    ("y", "ಯ"),
    ("r", "ರ"),
    ("l", "ಲ"),
    ("L", "ಳ"),
    ("v", "ವ"),
    ("w", "ವ"),
    ("s", "ಸ"),
    ("h", "ಹ"),
    ("f", "ಫ"),
    ("z", "ಜ"),
    ("q", "ಕ"),
    ("x", "ಕ್ಷ"),
]

_VOWELS: list[tuple[str, str]] = [
    ("ai", "ಐ"),
    ("au", "ಔ"),
    ("aa", "ಆ"),
    ("ee", "ಈ"),
    ("oo", "ಊ"),
    ("A", "ಆ"),
    ("I", "ಈ"),
    ("U", "ಊ"),
    ("E", "ಏ"),
    ("O", "ಓ"),
    ("a", "ಅ"),
    ("i", "ಇ"),
    ("u", "ಉ"),
    ("e", "ಎ"),
    ("o", "ಒ"),
    ("R", "ಋ"),
]

_DEPENDENT = {
    "ಅ": "",
    "ಆ": "ಾ",
    "ಇ": "ಿ",
    "ಈ": "ೀ",
    "ಉ": "ು",
    "ಊ": "ೂ",
    "ಋ": "ೃ",
    "ಎ": "ೆ",
    "ಏ": "ೇ",
    "ಐ": "ೈ",
    "ಒ": "ೊ",
    "ಓ": "ೋ",
    "ಔ": "ೌ",
}

_HALANT = "್"
_ANUSVARA = "ಂ"
_VISARGA = "ಃ"
_KANNADA_RE = re.compile(r"[\u0C80-\u0CFF]")
_LATIN_RE = re.compile(r"[A-Za-z]+")


def _match(table: list[tuple[str, str]], text: str, i: int) -> tuple[str, str] | None:
    for key, value in table:
        if text.startswith(key, i):
            return key, value
    return None


def transliterate_word(word: str) -> str:
    """Convert one English phonetic token to Kannada."""
    if not word:
        return ""
    if _KANNADA_RE.fullmatch(word):
        return word

    out: list[str] = []
    i = 0
    pending: str | None = None  # pending consonant (without virama applied yet)

    def flush_consonant(with_vowel: str | None = None, virama: bool = False) -> None:
        nonlocal pending
        if pending is None:
            if with_vowel:
                out.append(with_vowel)
            return
        if with_vowel is not None:
            out.append(pending + _DEPENDENT.get(with_vowel, ""))
        elif virama:
            out.append(pending + _HALANT)
        else:
            out.append(pending)
        pending = None

    while i < len(word):
        ch = word[i]
        if ch in "Mm" and pending is not None:
            flush_consonant(virama=False)
            out.append(_ANUSVARA)
            i += 1
            continue
        if ch == "H" and pending is not None:
            flush_consonant()
            out.append(_VISARGA)
            i += 1
            continue
        if ch == "~":
            flush_consonant()
            out.append(_ANUSVARA)
            i += 1
            continue

        cons = _match(_CONSONANTS, word, i)
        vow = _match(_VOWELS, word, i)

        # Prefer longer token when both could match (e.g. 'ch' vs 'c').
        if cons and vow:
            if len(cons[0]) >= len(vow[0]):
                vow = None
            else:
                cons = None

        if cons:
            if pending is not None:
                out.append(pending + _HALANT)
            pending = cons[1]
            i += len(cons[0])
            continue

        if vow:
            flush_consonant(with_vowel=vow[1])
            i += len(vow[0])
            continue

        flush_consonant()
        out.append(ch)
        i += 1

    flush_consonant()
    return "".join(out)


def english_to_kannada(text: str | None) -> str:
    """Transliterate English (or mixed) text to Kannada Unicode, leaving digits/punctuation."""
    if text is None:
        return ""
    raw = str(text)
    if not raw.strip():
        return ""
    if _KANNADA_RE.search(raw) and not _LATIN_RE.search(raw):
        return unicodedata.normalize("NFC", raw)

    parts = re.split(r"(\s+)", raw)
    converted: list[str] = []
    for part in parts:
        if not part or part.isspace():
            converted.append(part)
            continue
        # Keep existing Kannada; transliterate latin runs inside the token.
        chunks = re.split(r"([A-Za-z]+)", part)
        inner: list[str] = []
        for chunk in chunks:
            if not chunk:
                continue
            if chunk.isascii() and any(c.isalpha() for c in chunk):
                inner.append(transliterate_word(chunk))
            else:
                inner.append(chunk)
        converted.append("".join(inner))
    return unicodedata.normalize("NFC", "".join(converted))
