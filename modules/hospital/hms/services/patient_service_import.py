"""Excel / CSV template and row parsing for patient service import."""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 2000
_TWOPLACES = Decimal("0.01")
_HEADER_SCAN = 10

_CODE_HEADERS = {"code", "servicecode"}
_NAME_HEADERS = {"name", "servicename", "service"}
_RATE_HEADERS = {"rate", "price", "amount", "servicerate"}
_CHARGE_HEADERS = {"servicecharge", "charge", "charges"}


@dataclass
class ServiceImportRow:
    row_number: int
    code: str | None
    name: str
    rate: Decimal
    service_charge: Decimal
    auto_code: bool = False
    error: str | None = None


def build_patient_service_template() -> bytes:
    wb = Workbook()
    services = wb.active
    services.title = "Services"
    headers = ["Code", "Name", "Rate", "Service Charge"]
    services.append(headers)
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="1E40AF")
    notes = {
        1: "Optional. Leave blank and a code is created on import (same as Save on the screen).",
        2: "Required. Service name.",
        3: "Required. Bill rate. Use 0 if the service is free.",
        4: "Optional. Leave blank to use the same amount as Rate.",
    }
    for col, header in enumerate(headers, start=1):
        cell = services.cell(1, col, header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        comment = Comment(notes[col], "ERP")
        comment.width = 260
        comment.height = 70
        cell.comment = comment
    widths = (22, 40, 16, 18)
    formats = ("@", "General", "0.00", "0.00")
    for index, (width, number_format) in enumerate(zip(widths, formats), start=1):
        column = services.column_dimensions[get_column_letter(index)]
        column.width = width
        column.number_format = number_format
    services.freeze_panes = "A2"
    services.auto_filter.ref = "A1:D1"
    services.sheet_properties.tabColor = "1E40AF"

    info = wb.create_sheet("Instructions")
    info.sheet_properties.tabColor = "64748B"
    info["A1"] = "Patient service import"
    info["A1"].font = Font(bold=True, size=14, color="1E40AF")
    info["A2"] = (
        "Fill the Services sheet, then import that file. "
        "Do not rename the Services headers. This Instructions sheet is ignored."
    )
    info["A2"].alignment = Alignment(wrap_text=True)
    info.merge_cells("A2:C2")
    info.append([])
    info.append(["Field", "Required", "Notes"])
    for cell in info[4]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
    info.append(["Code", "No", "Leave blank to generate a code. A code you type must be unique. Deleted codes are restored."])
    info.append(["Name", "Yes", "Service name, up to 200 characters."])
    info.append(["Rate", "Yes", "Bill rate. 0 is allowed. Example: 500 or 150.50"])
    info.append(["Service Charge", "No", "Leave blank to copy Rate. Type 0 to keep the charge at zero."])
    info.append([])
    info.append(["Examples (type these on the Services sheet)"])
    info["A10"].font = Font(bold=True)
    info.append(["Code", "Name", "Rate", "Service Charge", "What is saved"])
    info.append(["", "Consultation", 500, "", "Code is generated. Service charge becomes 500."])
    info.append(["OPD01", "Dressing", 150, 20, "Code OPD01, rate 150, service charge 20."])
    info.column_dimensions["A"].width = 22
    info.column_dimensions["B"].width = 22
    info.column_dimensions["C"].width = 88
    info.column_dimensions["D"].width = 18
    info.column_dimensions["E"].width = 62
    for row in info.iter_rows(min_row=5, max_row=8, min_col=3, max_col=3):
        for cell in row:
            cell.alignment = Alignment(wrap_text=True)
    info.row_dimensions[2].height = 32
    info.page_setup.fitToPage = True
    info.page_setup.fitToWidth = 1
    info.page_setup.fitToHeight = 1

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def load_service_table(data: bytes, filename: str) -> list[list[object]]:
    if not data:
        raise ValueError("The uploaded file is empty.")
    if len(data) > MAX_BYTES:
        raise ValueError("File is too large (max 5 MB).")
    name = (filename or "").strip().lower()
    payload = data.lstrip()
    if name.endswith(".xls") and not name.endswith(".xlsx"):
        raise ValueError("Save the file as .xlsx or .csv, then import it.")
    if payload.startswith(b"PK") or name.endswith(".xlsx"):
        return _read_xlsx(data)
    if name.endswith(".csv") or name.endswith(".txt") or b"\x00" not in data[:2000]:
        return _read_csv(data)
    raise ValueError("Upload the Excel template (.xlsx) or a .csv file.")


def interpret_service_rows(table: list[list[object]]) -> list[ServiceImportRow]:
    header_at = _header_index(table)
    if header_at is None:
        raise ValueError(
            "Could not find Name and Rate columns. Download the template and keep those headers."
        )
    mapping = _header_map(table[header_at])
    parsed: list[ServiceImportRow] = []
    data_rows = 0
    for row_number, row in enumerate(table[header_at + 1 :], start=header_at + 2):
        item = _interpret_row(row_number, row, mapping)
        if item is None:
            continue
        data_rows += 1
        if data_rows > MAX_ROWS:
            parsed.append(
                ServiceImportRow(
                    row_number=row_number,
                    code=None,
                    name="",
                    rate=Decimal("0"),
                    service_charge=Decimal("0"),
                    error=f"Stopped after {MAX_ROWS} rows",
                )
            )
            break
        parsed.append(item)
    return parsed


def _read_xlsx(data: bytes) -> list[list[object]]:
    try:
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:
        raise ValueError(
            "Could not read this spreadsheet. Use the Excel template (.xlsx) or a .csv file."
        ) from exc
    try:
        services_rows: list[list[object]] | None = None
        fallback: list[list[object]] | None = None
        first: list[list[object]] | None = None
        for sheet in workbook.worksheets:
            title = (sheet.title or "").strip().lower()
            if title == "instructions":
                continue
            rows = [list(row) for row in sheet.iter_rows(values_only=True)]
            if first is None:
                first = rows
            if _header_index(rows) is None:
                continue
            if title == "services":
                services_rows = rows
                break
            if fallback is None:
                fallback = rows
        chosen = services_rows or fallback or first
        if chosen is None:
            raise ValueError("The workbook has no Services sheet.")
        return chosen
    finally:
        workbook.close()


def _read_csv(data: bytes) -> list[list[object]]:
    text = data.decode("utf-8-sig", errors="replace")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
    except csv.Error:
        dialect = csv.excel
    return [list(row) for row in csv.reader(io.StringIO(text), dialect)]


def _header_index(table: list[list[object]]) -> int | None:
    for index, row in enumerate(table[:_HEADER_SCAN]):
        mapping = _header_map(row)
        if "name" in mapping and "rate" in mapping:
            return index
    return None


def _header_map(row: list[object]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for index, cell in enumerate(row):
        key = _norm_header(cell)
        if key in _CODE_HEADERS and "code" not in mapping:
            mapping["code"] = index
        elif key in _NAME_HEADERS and "name" not in mapping:
            mapping["name"] = index
        elif key in _RATE_HEADERS and "rate" not in mapping:
            mapping["rate"] = index
        elif key in _CHARGE_HEADERS and "charge" not in mapping:
            mapping["charge"] = index
    return mapping


def _interpret_row(
    row_number: int, row: list[object], mapping: dict[str, int]
) -> ServiceImportRow | None:
    code_cell = _cell(row, mapping.get("code"))
    name_cell = _cell(row, mapping.get("name"))
    rate_cell = _cell(row, mapping.get("rate"))
    charge_cell = _cell(row, mapping.get("charge")) if "charge" in mapping else None
    if _is_empty(code_cell) and _is_empty(name_cell) and _is_empty(rate_cell) and _is_empty(charge_cell):
        return None

    problems: list[str] = []
    code = _as_text(code_cell).upper()
    name = _as_text(name_cell)
    if code and len(code) > 30:
        problems.append("Code is longer than 30 characters")
    if not name:
        problems.append("Name is required")
    elif len(name) > 200:
        problems.append("Name is longer than 200 characters")

    rate = Decimal("0")
    if _is_empty(rate_cell):
        problems.append("Rate is required")
    else:
        try:
            parsed_rate = _money(rate_cell)
        except (InvalidOperation, ValueError):
            problems.append("Rate must be a number")
            parsed_rate = None
        if parsed_rate is not None and parsed_rate < 0:
            problems.append("Rate cannot be negative")
        elif parsed_rate is not None:
            rate = parsed_rate

    charge = rate
    if not _is_empty(charge_cell):
        try:
            parsed_charge = _money(charge_cell)
        except (InvalidOperation, ValueError):
            problems.append("Service charge must be a number")
            parsed_charge = None
        if parsed_charge is not None and parsed_charge < 0:
            problems.append("Service charge cannot be negative")
        elif parsed_charge is not None:
            charge = parsed_charge

    if problems:
        return ServiceImportRow(
            row_number=row_number,
            code=code or None,
            name=name,
            rate=rate,
            service_charge=charge,
            error="; ".join(problems),
        )
    return ServiceImportRow(
        row_number=row_number,
        code=code or None,
        name=name,
        rate=rate,
        service_charge=charge,
        auto_code=not bool(code),
    )


def _cell(row: list[object], index: int | None) -> object:
    if index is None or index < 0 or index >= len(row):
        return None
    return row[index]


def _is_empty(value: object) -> bool:
    return _as_text(value) == ""


def _norm_header(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", _as_text(value).lower())


def _as_text(value: object) -> str:
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value:  # NaN
            return ""
        if value.is_integer():
            return str(int(value))
        text = format(value, "f").rstrip("0").rstrip(".")
        return text
    if isinstance(value, Decimal):
        if not value.is_finite():
            return ""
        if value == value.to_integral():
            return str(int(value))
        return format(value, "f")
    return str(value).strip()


def _money(value: object) -> Decimal:
    if isinstance(value, Decimal):
        number = value
    elif isinstance(value, int) and not isinstance(value, bool):
        number = Decimal(value)
    elif isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise InvalidOperation
        number = Decimal(str(value))
    else:
        text = _as_text(value)
        text = re.sub(r"(?i)(?:rs\.?|inr|₹|\$)", "", text)
        text = text.replace(",", "").replace("/-", "")
        text = re.sub(r"\s+", "", text)
        if not text:
            raise InvalidOperation
        number = Decimal(text)
    if not number.is_finite():
        raise InvalidOperation
    quantized = number.quantize(_TWOPLACES, rounding=ROUND_HALF_UP)
    if quantized.copy_abs() > Decimal("9999999999.99"):
        raise InvalidOperation
    return quantized
