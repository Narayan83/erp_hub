"""Indian-English amount in words (Rupees … only)."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

_ONES = (
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
)
_TENS = ("", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety")


def _two_digits(n: int) -> str:
    if n < 20:
        return _ONES[n]
    tens, ones = divmod(n, 10)
    if ones:
        return f"{_TENS[tens]} {_ONES[ones]}"
    return _TENS[tens]


def _three_digits(n: int) -> str:
    hundred, rest = divmod(n, 100)
    parts: list[str] = []
    if hundred:
        parts.append(f"{_ONES[hundred]} Hundred")
    if rest:
        parts.append(_two_digits(rest))
    return " ".join(parts)


def _rupees_words(n: int) -> str:
    if n == 0:
        return "Zero"
    crore, rest = divmod(n, 10_000_000)
    lakh, rest = divmod(rest, 100_000)
    thousand, rest = divmod(rest, 1000)
    parts: list[str] = []
    if crore:
        parts.append(f"{_rupees_words(crore)} Crore")
    if lakh:
        parts.append(f"{_three_digits(lakh)} Lakh")
    if thousand:
        parts.append(f"{_three_digits(thousand)} Thousand")
    if rest:
        parts.append(_three_digits(rest))
    return " ".join(p for p in parts if p)


def amount_in_words(value: object) -> str:
    amount = Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if amount < 0:
        amount = Decimal("0.00")
    rupees = int(amount)
    paise = int((amount - rupees) * 100)
    text = f"Rupees {_rupees_words(rupees)}"
    if paise:
        text += f" and {_two_digits(paise)} Paise"
    return f"{text} only"
