"""Custom bill layouts stored on PrintConfig.layout_options.

Same idea as GenERP print templates: each document (OPD bill, IPD bill, …)
has ordered bands. Staff print the saved layout. Until a layout is saved
from the designer, the existing fixed HTML template is used.
"""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

LAYOUT_VERSION = 1
KIND_BILL = "bill"

STANDARD_PAGES: dict[str, tuple[str, float, float]] = {
    "A4": ("A4", 210.0, 297.0),
    "A5": ("A5", 148.0, 210.0),
    "A6": ("A6", 105.0, 148.0),
    "LETTER": ("Letter", 215.9, 279.4),
    "LEGAL": ("Legal", 215.9, 355.6),
}

DOCUMENT_NAMES: dict[str, str] = {
    "OPD_BILL": "OPD Bill",
    "IPD_BILL": "IPD Bill",
    "PATHOLOGY_BILL": "Pathology Bill",
    "PHARMACY_SALE_BILL": "Medicine Sale Bill / Sales Return",
    "PHARMACY_PURCHASE_BILL": "Medicine Purchase Bill / Purchase Return",
    "ADVANCE_RECEIPT": "Advance Receipt",
    "SINGLE_SERVICE_OPD": "Single Service OPD Bill",
    "SHORT_BILL": "Short Bill",
    "PATHOLOGY_REPORT": "Pathology Lab Report",
    "DISCHARGE_SUMMARY": "Discharge Summary",
    "OPD_CASESHEET": "OPD Case Sheet",
    "PATIENT_CARD": "Patient Card",
    "USER_CASH_REPORT": "User wise Cash Transaction Report",
    "DOCTOR_COLLECTION": "Doctor wise Collection Report",
    "PATHOLOGY_DOCTOR_COLLECTION": "Pathology Doctor wise Collection Report",
    "TOKEN_USERWISE_REPORT": "Token Number Userwise Report",
    "FORM_3C_REPORT": "Form 3C Report",
    "CANCELLATION_BILL_REPORT": "Cancellation Bill Details Report",
    "MODIFICATION_BILL_REPORT": "Modification Bill Details Report",
    "SHORT_BILL_REPORT": "Short Bill Report",
    "SINGLE_SERVICE_OPD_REPORT": "Single Service OPD Report",
    "SALES_REGISTER": "Sales Register",
    "SALES_SUMMARY": "Sales Summary",
    "SCHEDULE_H_DRUG_REPORT": "Schedule H Drug Report",
    "CONSOLIDATED_STOCK_REPORT": "Consolidated Stock Report",
}

# PrintConfig.code is varchar(40). SSO + 32 hex digits of the option id fits.
_SSO_LAYOUT_RE = re.compile(r"^SSO([0-9A-F]{32})$")

# Bills keep the full field catalog (including fields that start hidden).
# Other documents only show the fields listed for that report.
_BILL_CODES = {
    "OPD_BILL",
    "IPD_BILL",
    "PATHOLOGY_BILL",
    "PHARMACY_SALE_BILL",
    "PHARMACY_PURCHASE_BILL",
    "ADVANCE_RECEIPT",
    "SINGLE_SERVICE_OPD",
    "SHORT_BILL",
}

_LANDSCAPE_CODES = {
    "USER_CASH_REPORT",
    "DOCTOR_COLLECTION",
    "PATHOLOGY_DOCTOR_COLLECTION",
    "TOKEN_USERWISE_REPORT",
    "FORM_3C_REPORT",
    "CANCELLATION_BILL_REPORT",
    "MODIFICATION_BILL_REPORT",
    "SALES_REGISTER",
    "SCHEDULE_H_DRUG_REPORT",
    "CONSOLIDATED_STOCK_REPORT",
}

BANDS = ("header", "meta", "columns", "totals", "footer")

# id, caption, band
BILL_CATALOG: list[dict[str, Any]] = [
    {"id": "hospital_name", "label": "Hospital name", "band": "header"},
    {"id": "hospital_address", "label": "Address", "band": "header"},
    {"id": "hospital_phone", "label": "Phone", "band": "header"},
    {"id": "hospital_mobile", "label": "Mobile", "band": "header"},
    {"id": "hospital_email", "label": "Email", "band": "header"},
    {"id": "hospital_gstin", "label": "GSTIN", "band": "header"},
    {"id": "hospital_registration_number", "label": "Hospital registration no", "band": "header"},
    {"id": "hospital_website", "label": "Website", "band": "header"},
    {"id": "hospital_software_id", "label": "Software ID", "band": "header"},
    {"id": "bill_title", "label": "Bill title", "band": "header"},
    {"id": "patient_no", "label": "Patient ID", "band": "meta"},
    {"id": "patient_name", "label": "Patient name", "band": "meta"},
    {"id": "patient_age", "label": "Age", "band": "meta"},
    {"id": "patient_gender", "label": "Sex", "band": "meta"},
    {"id": "doctor_name", "label": "Doctor", "band": "meta"},
    {"id": "referring_doctor", "label": "Referring doctor", "band": "meta"},
    {"id": "department_name", "label": "Department", "band": "meta"},
    {"id": "bill_no", "label": "Bill no", "band": "meta"},
    {"id": "bill_date", "label": "Date", "band": "meta"},
    {"id": "voucher_no", "label": "Receipt no", "band": "meta"},
    {"id": "voucher_date", "label": "Receipt date", "band": "meta"},
    {"id": "admission_no", "label": "Admission no", "band": "meta"},
    {"id": "ward_bed", "label": "Ward / bed", "band": "meta"},
    {"id": "stay_days", "label": "Stay days", "band": "meta"},
    {"id": "admission_date", "label": "Admit date", "band": "meta"},
    {"id": "discharge_date", "label": "Discharge date", "band": "meta"},
    {"id": "scheme", "label": "Scheme", "band": "meta"},
    {"id": "cash_credit", "label": "Cash / credit", "band": "meta"},
    {"id": "token_number", "label": "Token", "band": "meta"},
    {"id": "sample_no", "label": "Sample no", "band": "meta"},
    {"id": "visit_category", "label": "Visit type", "band": "meta"},
    {"id": "sr", "label": "Sl.No", "band": "columns", "align": "center", "width": 8},
    {"id": "code", "label": "Code", "band": "columns", "align": "left", "width": 12},
    {"id": "name", "label": "Service", "band": "columns", "align": "left", "width": 46},
    {"id": "category", "label": "Category", "band": "columns", "align": "left", "width": 16},
    {"id": "rate", "label": "Rate", "band": "columns", "align": "right", "width": 12},
    {"id": "qty", "label": "Qty", "band": "columns", "align": "right", "width": 10},
    {"id": "amount", "label": "Amount", "band": "columns", "align": "right", "width": 12},
    {"id": "gross_amount", "label": "Gross", "band": "totals"},
    {"id": "admin_charges", "label": "Admin charges", "band": "totals"},
    {"id": "scheme_discount", "label": "Discount", "band": "totals"},
    {"id": "adjust_advance", "label": "Advance adjusted", "band": "totals"},
    {"id": "net_amount", "label": "Net amount", "band": "totals"},
    {"id": "amount", "label": "Amount", "band": "totals"},
    {"id": "balance_after", "label": "Balance after", "band": "totals"},
    {"id": "payment_mode", "label": "Payment", "band": "footer"},
    {"id": "remarks", "label": "Remarks", "band": "footer"},
    {"id": "computer_note", "label": "Computer note", "band": "footer"},
    {"id": "signature", "label": "Signature", "band": "footer"},
    {"id": "thanks", "label": "Thank you line", "band": "footer"},
]

# Extra fields used by cash, collection, and other list reports.
REPORT_FIELDS: list[dict[str, Any]] = [
    {"id": "period_label", "label": "Period", "band": "meta"},
    {"id": "user_name", "label": "User", "band": "meta"},
    {"id": "payment_mode_label", "label": "Payment mode", "band": "meta"},
    {"id": "billing_type_label", "label": "Billing type", "band": "meta"},
    {"id": "bill_type_label", "label": "Bill type", "band": "meta"},
    {"id": "bill_date", "label": "Date", "band": "columns", "align": "left", "width": 10},
    {"id": "bill_no", "label": "Bill no", "band": "columns", "align": "left", "width": 12},
    {"id": "patient_no", "label": "Patient ID", "band": "columns", "align": "left", "width": 12},
    {"id": "patient_name", "label": "Patient name", "band": "columns", "align": "left", "width": 18},
    {"id": "doctor_name", "label": "Doctor", "band": "columns", "align": "left", "width": 14},
    {"id": "service_name", "label": "Service", "band": "columns", "align": "left", "width": 18},
    {"id": "payment_mode", "label": "Payment mode", "band": "columns", "align": "left", "width": 12},
    {"id": "user_name", "label": "User", "band": "columns", "align": "left", "width": 14},
    {"id": "bill_type", "label": "Type", "band": "columns", "align": "left", "width": 8},
    {"id": "bill_type_totals", "label": "Bill type totals", "band": "columns", "align": "left", "width": 20},
    {"id": "payment_mode_totals", "label": "Payment mode totals", "band": "columns", "align": "left", "width": 18},
    {"id": "day_total", "label": "Day total", "band": "columns", "align": "right", "width": 10},
    {"id": "hospital_amount", "label": "Hospital", "band": "columns", "align": "right", "width": 10},
    {"id": "doctor_amount", "label": "Doctor amount", "band": "columns", "align": "right", "width": 10},
    {"id": "total_amount", "label": "Total", "band": "columns", "align": "right", "width": 10},
    {"id": "gross_amount", "label": "Gross", "band": "columns", "align": "right", "width": 10},
    {"id": "scheme_discount", "label": "Discount", "band": "columns", "align": "right", "width": 10},
    {"id": "net_amount", "label": "Net", "band": "columns", "align": "right", "width": 10},
    {"id": "cancellation_remarks", "label": "Cancellation remarks", "band": "columns", "align": "left", "width": 16},
    {"id": "cancelled_at", "label": "Cancelled at", "band": "columns", "align": "left", "width": 12},
    {"id": "cancelled_by", "label": "Cancelled by", "band": "columns", "align": "left", "width": 10},
    {"id": "modified_at", "label": "Modified at", "band": "columns", "align": "left", "width": 12},
    {"id": "modified_by", "label": "Modified by", "band": "columns", "align": "left", "width": 12},
    {"id": "token_number", "label": "Token", "band": "columns", "align": "center", "width": 8},
    {"id": "item_code", "label": "Item code", "band": "columns", "align": "left", "width": 12},
    {"id": "item_name", "label": "Item name", "band": "columns", "align": "left", "width": 22},
    {"id": "schedule", "label": "Schedule", "band": "columns", "align": "left", "width": 10},
    {"id": "unit", "label": "Unit", "band": "columns", "align": "left", "width": 8},
    {"id": "balance", "label": "Balance", "band": "columns", "align": "right", "width": 10},
    {"id": "grand_total", "label": "Grand total", "band": "totals"},
]

FIELD_CATALOG: list[dict[str, Any]] = BILL_CATALOG + REPORT_FIELDS

# Totals "amount" and columns don't share ids across bands — catalog ids must be unique
# per band. The totals amount uses id "receipt_amount" to avoid clashing with column "amount".
for _row in BILL_CATALOG:
    if _row["id"] == "amount" and _row["band"] == "totals":
        _row["id"] = "receipt_amount"

DEFAULT_COMPUTER_NOTE = "Computer generated bill — signature not required."
DEFAULT_SIGNATURE = "Receiver's Signature"
DEFAULT_THANKS = "Thank you"

_TEXT_DEFAULTS = {
    "computer_note": DEFAULT_COMPUTER_NOTE,
    "signature": DEFAULT_SIGNATURE,
    "thanks": DEFAULT_THANKS,
}

# Visible field ids per document. Anything else stays in the catalog but hidden.
_VISIBLE: dict[str, dict[str, list[str]]] = {
    "OPD_BILL": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["patient_no", "department_name", "bill_date", "patient_name", "doctor_name", "bill_no"],
        "columns": ["sr", "name", "rate", "qty", "amount"],
        "totals": ["admin_charges", "scheme_discount", "adjust_advance", "net_amount"],
        "footer": ["token_number", "payment_mode", "remarks", "computer_note", "signature"],
    },
    "IPD_BILL": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": [
            "patient_no", "department_name", "bill_date",
            "patient_name", "doctor_name", "bill_no",
            "admission_no", "ward_bed", "stay_days",
            "admission_date", "discharge_date",
        ],
        "columns": ["sr", "name", "rate", "qty", "amount"],
        "totals": ["admin_charges", "scheme_discount", "adjust_advance", "net_amount"],
        "footer": ["payment_mode", "remarks", "computer_note", "signature"],
    },
    "PATHOLOGY_BILL": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": [
            "patient_no", "patient_name", "patient_age", "patient_gender",
            "doctor_name", "referring_doctor", "bill_no", "bill_date", "sample_no",
        ],
        "columns": ["sr", "name", "rate", "qty", "amount"],
        "totals": ["admin_charges", "scheme_discount", "net_amount"],
        "footer": ["payment_mode", "remarks", "computer_note", "signature"],
    },
    "PHARMACY_SALE_BILL": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["patient_no", "patient_name", "doctor_name", "bill_no", "bill_date"],
        "columns": ["sr", "name", "category", "rate", "qty", "amount"],
        "totals": ["scheme_discount", "net_amount"],
        "footer": ["payment_mode", "remarks", "computer_note", "signature"],
    },
    "PHARMACY_PURCHASE_BILL": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["patient_name", "patient_no", "bill_no", "bill_date"],
        "columns": ["sr", "code", "name", "category", "rate", "qty", "amount"],
        "totals": ["scheme_discount", "net_amount"],
        "footer": ["remarks", "computer_note", "signature"],
    },
    "ADVANCE_RECEIPT": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["patient_no", "patient_name", "voucher_no", "voucher_date"],
        "columns": [],
        "totals": ["receipt_amount", "balance_after"],
        "footer": ["payment_mode", "remarks", "computer_note", "signature"],
    },
    "SINGLE_SERVICE_OPD": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["patient_no", "department_name", "bill_date", "patient_name", "doctor_name", "bill_no"],
        "columns": ["sr", "name", "rate", "qty", "amount"],
        "totals": ["net_amount"],
        "footer": ["payment_mode", "remarks", "computer_note", "signature"],
    },
    "SHORT_BILL": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["patient_no", "patient_name", "doctor_name", "bill_no", "bill_date"],
        "columns": ["sr", "name", "rate", "qty", "amount"],
        "totals": ["net_amount"],
        "footer": ["payment_mode", "remarks", "computer_note", "signature"],
    },
    "PATHOLOGY_REPORT": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["patient_no", "patient_name", "patient_age", "patient_gender", "doctor_name", "bill_no", "bill_date", "sample_no"],
        "columns": ["sr", "name"],
        "totals": [],
        "footer": ["computer_note", "signature"],
    },
    "DISCHARGE_SUMMARY": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["patient_no", "patient_name", "doctor_name", "admission_no", "ward_bed", "admission_date", "discharge_date"],
        "columns": [],
        "totals": [],
        "footer": ["signature"],
    },
    "OPD_CASESHEET": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["patient_no", "patient_name", "patient_age", "patient_gender", "doctor_name", "department_name", "bill_date", "token_number"],
        "columns": [],
        "totals": [],
        "footer": ["signature"],
    },
    "PATIENT_CARD": {
        "header": ["hospital_name", "hospital_phone", "bill_title"],
        "meta": ["patient_no", "patient_name", "patient_age", "patient_gender", "doctor_name"],
        "columns": [],
        "totals": [],
        "footer": [],
    },
    "USER_CASH_REPORT": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["user_name", "period_label", "payment_mode_label"],
        "columns": ["bill_no", "patient_no", "patient_name", "user_name", "bill_type_totals", "payment_mode_totals", "amount", "day_total"],
        "totals": ["grand_total"],
        "footer": ["computer_note"],
    },
    "DOCTOR_COLLECTION": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["period_label", "doctor_name"],
        "columns": ["bill_date", "bill_no", "patient_no", "patient_name", "doctor_name", "service_name", "payment_mode", "hospital_amount", "doctor_amount", "total_amount"],
        "totals": ["grand_total"],
        "footer": ["computer_note"],
    },
    "PATHOLOGY_DOCTOR_COLLECTION": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["period_label", "doctor_name"],
        "columns": ["bill_date", "bill_no", "patient_no", "patient_name", "doctor_name", "service_name", "payment_mode", "hospital_amount", "doctor_amount", "total_amount"],
        "totals": ["grand_total"],
        "footer": ["computer_note"],
    },
    "TOKEN_USERWISE_REPORT": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["period_label", "user_name"],
        "columns": ["token_number", "bill_date", "patient_no", "patient_name", "doctor_name", "user_name"],
        "totals": [],
        "footer": ["computer_note"],
    },
    "FORM_3C_REPORT": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["period_label", "billing_type_label"],
        "columns": ["sr", "bill_date", "bill_no", "payment_mode", "patient_name", "service_name", "amount"],
        "totals": ["grand_total"],
        "footer": ["computer_note"],
    },
    "CANCELLATION_BILL_REPORT": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["period_label", "bill_type_label"],
        "columns": ["sr", "bill_type", "bill_date", "bill_no", "patient_no", "patient_name", "amount", "cancellation_remarks", "cancelled_at", "cancelled_by"],
        "totals": ["grand_total"],
        "footer": ["computer_note"],
    },
    "MODIFICATION_BILL_REPORT": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["period_label", "bill_type_label"],
        "columns": ["sr", "bill_type", "bill_date", "bill_no", "patient_no", "patient_name", "amount", "modified_at", "modified_by"],
        "totals": ["grand_total"],
        "footer": ["computer_note"],
    },
    "SHORT_BILL_REPORT": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["period_label", "billing_type_label"],
        "columns": ["sr", "bill_date", "patient_name", "amount"],
        "totals": ["grand_total"],
        "footer": ["computer_note"],
    },
    "SINGLE_SERVICE_OPD_REPORT": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["period_label", "doctor_name"],
        "columns": ["sr", "bill_date", "bill_no", "patient_no", "patient_name", "service_name", "amount"],
        "totals": ["grand_total"],
        "footer": ["computer_note"],
    },
    "SALES_REGISTER": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["period_label"],
        "columns": ["bill_no", "bill_date", "patient_name", "qty", "gross_amount", "scheme_discount", "net_amount"],
        "totals": ["grand_total"],
        "footer": ["computer_note"],
    },
    "SALES_SUMMARY": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["period_label"],
        "columns": ["item_code", "item_name", "qty", "amount"],
        "totals": ["grand_total"],
        "footer": ["computer_note"],
    },
    "SCHEDULE_H_DRUG_REPORT": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": ["period_label"],
        "columns": ["bill_no", "bill_date", "patient_name", "item_code", "item_name", "schedule", "qty", "amount"],
        "totals": ["grand_total"],
        "footer": ["computer_note"],
    },
    "CONSOLIDATED_STOCK_REPORT": {
        "header": ["hospital_name", "hospital_address", "hospital_phone", "bill_title"],
        "meta": [],
        "columns": ["bill_type", "item_code", "item_name", "unit", "qty", "balance"],
        "totals": [],
        "footer": ["computer_note"],
    },
}

# token_number is meta in catalog but OPD footer list referenced it — keep it in meta.
_VISIBLE["OPD_BILL"]["meta"] = [
    "patient_no", "department_name", "bill_date",
    "patient_name", "doctor_name", "bill_no", "token_number",
]
_VISIBLE["OPD_BILL"]["footer"] = ["payment_mode", "remarks", "computer_note", "signature"]


def single_service_option_layout_code(option_id: str) -> str:
    """Stable print-template code for one Single Service OPD billing option."""
    compact = re.sub(r"[^0-9a-fA-F]", "", str(option_id or ""))
    if len(compact) != 32:
        raise ValueError("option id is not a UUID")
    return f"SSO{compact.upper()}"


def single_service_option_id_from_layout_code(code: str) -> str | None:
    match = _SSO_LAYOUT_RE.match((code or "").strip().upper())
    if not match:
        return None
    hexpart = match.group(1).lower()
    return (
        f"{hexpart[0:8]}-{hexpart[8:12]}-{hexpart[12:16]}-"
        f"{hexpart[16:20]}-{hexpart[20:32]}"
    )


def layout_family(code: str) -> str:
    """Field catalog used by a document code. Option templates share the single-service bill."""
    code_u = (code or "").strip().upper()
    if single_service_option_id_from_layout_code(code_u):
        return "SINGLE_SERVICE_OPD"
    if code_u in DOCUMENT_NAMES:
        return code_u
    return "OPD_BILL"


def catalog_with_single_service_options(options: list[tuple[str, str]]) -> dict[str, Any]:
    """Static documents, with each active single-service option listed under that bill."""
    payload = catalog_payload()
    extra: list[dict[str, str]] = []
    for option_id, name in options:
        label = (name or "").strip()
        if not label:
            continue
        try:
            code = single_service_option_layout_code(option_id)
        except ValueError:
            continue
        extra.append({"code": code, "name": label, "kind": KIND_BILL})
    documents = list(payload["documents"])
    insert_at = next(
        (index + 1 for index, doc in enumerate(documents) if doc["code"] == "SINGLE_SERVICE_OPD"),
        len(documents),
    )
    payload["documents"] = documents[:insert_at] + extra + documents[insert_at:]
    return payload


def catalog_payload() -> dict[str, Any]:
    payload = {
        "version": LAYOUT_VERSION,
        "documents": [
            {
                "code": code,
                "name": name,
                "kind": KIND_BILL if code in _BILL_CODES else "report",
            }
            for code, name in DOCUMENT_NAMES.items()
        ],
        "formats": [{"code": code, "name": label} for code, (label, _w, _h) in STANDARD_PAGES.items()],
        "bands": [{"id": band, "label": band.title()} for band in BANDS],
        "fields": deepcopy(FIELD_CATALOG),
    }
    return _labels_for_active_product(payload)


_CLINICAL_WORDS = (
    "opd",
    "ipd",
    "pathology",
    "pharmacy",
    "patient",
    "doctor",
    "discharge",
    "ward",
    "medicine",
    "form 3c",
    "form_3c",
    "token",
    "short bill",
    "short_bill",
    "drug",
    "case sheet",
)


def _labels_for_active_product(payload: dict[str, Any]) -> dict[str, Any]:
    """Hospital wording stays on the hospital product only."""
    from erp_core.product_config import get_product_name, label

    if get_product_name() == "hospital":
        return payload
    party = label("party", "Party")
    company = label("company", "Company")
    rename = {
        "hospital_name": f"{company} name",
        "hospital_address": "Address",
        "hospital_phone": "Phone",
        "hospital_mobile": "Mobile",
        "hospital_email": "Email",
        "hospital_gstin": "GSTIN",
        "hospital_registration_number": "Registration no",
        "hospital_website": "Website",
        "hospital_software_id": "Software ID",
        "hospital_amount": company,
        "patient_no": f"{party} no",
        "patient_name": f"{party} name",
        "patient_age": "Age",
        "patient_gender": "Sex",
    }
    fields = []
    for row in payload.get("fields") or []:
        item = dict(row)
        if item.get("id") in rename:
            item["label"] = rename[item["id"]]
        else:
            text = str(item.get("label") or "")
            item["label"] = text.replace("Hospital", company).replace("Patient", party)
        fields.append(item)
    payload["fields"] = fields
    kept = []
    for doc in payload.get("documents") or []:
        blob = f"{doc.get('code', '')} {doc.get('name', '')}".lower()
        if any(word in blob for word in _CLINICAL_WORDS):
            continue
        kept.append(doc)
    payload["documents"] = kept or [
        {"code": "ADVANCE_RECEIPT", "name": "Receipt", "kind": KIND_BILL}
    ]
    return payload


def _catalog_index() -> dict[tuple[str, str], dict[str, Any]]:
    return {(row["band"], row["id"]): row for row in FIELD_CATALOG}


def _optional_mm(raw: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        if raw.get(key) is None or raw.get(key) == "":
            continue
        try:
            value = float(raw[key])
        except (TypeError, ValueError):
            continue
        return round(max(0.0, min(1000.0, value)), 1)
    return None


def _clean_field(raw: dict[str, Any], catalog_row: dict[str, Any] | None) -> dict[str, Any] | None:
    fid = str(raw.get("id") or "").strip()
    if not fid:
        return None
    band = str(raw.get("band") or (catalog_row or {}).get("band") or "")
    if catalog_row is None and not fid.startswith("static_") and not fid.startswith("copy_"):
        return None
    align = str(raw.get("align") or (catalog_row or {}).get("align") or "left")
    if align not in {"left", "center", "right"}:
        align = "left"
    item: dict[str, Any] = {
        "id": fid,
        "band": band,
        "visible": bool(raw.get("visible", True)),
        "label": str(raw.get("label") or (catalog_row or {}).get("label") or fid)[:80],
        "align": align,
    }
    if band == "columns":
        try:
            width = float(raw.get("width") if raw.get("width") is not None else (catalog_row or {}).get("width") or 10)
        except (TypeError, ValueError):
            width = 10
        item["width"] = max(4.0, min(400.0, width))
    for dest, keys in (
        ("x_mm", ("x_mm", "xMm")),
        ("y_mm", ("y_mm", "yMm")),
        ("width_mm", ("width_mm", "widthMm")),
        ("height_mm", ("height_mm", "heightMm")),
    ):
        placed = _optional_mm(raw, *keys)
        if placed is not None:
            item[dest] = placed
    font = raw.get("font_size_pt") if raw.get("font_size_pt") is not None else raw.get("fontSizePt")
    if font is not None:
        try:
            item["font_size_pt"] = max(6.0, min(36.0, round(float(font), 1)))
        except (TypeError, ValueError):
            pass
    family = raw.get("font_family") if raw.get("font_family") is not None else raw.get("fontFamily")
    if family is not None:
        cleaned = "".join(ch for ch in str(family).strip() if ch.isprintable() and ch not in {"'", '"', ";", "<", ">"})
        if cleaned:
            item["font_family"] = cleaned[:80]
    for dest, keys in (
        ("font_bold", ("font_bold", "fontBold")),
        ("font_italic", ("font_italic", "fontItalic")),
        ("font_underline", ("font_underline", "fontUnderline")),
    ):
        if any(key in raw for key in keys):
            value = raw.get(keys[0]) if keys[0] in raw else raw.get(keys[1])
            item[dest] = bool(value)
    if fid.startswith("copy_"):
        source = str(raw.get("source_id") or "")[:40]
        if source:
            item["source_id"] = source
    if fid.startswith("static_") or fid in _TEXT_DEFAULTS or fid == "bill_title":
        text = raw.get("text")
        if text is None and fid in _TEXT_DEFAULTS:
            text = _TEXT_DEFAULTS[fid]
        if text is not None:
            item["text"] = str(text)[:500]
    # Custom captions: if staff renamed the caption but left the placeholder printed
    # text, print the name they typed.
    if fid.startswith("static_"):
        label = str(item.get("label") or "").strip()
        printed = str(item.get("text") or "").strip()
        placeholders = {"", "Caption", "Custom caption text", "Text"}
        if label and printed in placeholders and label not in placeholders:
            item["text"] = label[:500]
        elif printed and label in placeholders:
            item["label"] = printed[:80]
        elif label and not printed:
            item["text"] = label[:500]
        elif printed and not label:
            item["label"] = printed[:80]
    return item


def _default_band(code: str, band: str) -> list[dict[str, Any]]:
    visible = set((_VISIBLE.get(code) or _VISIBLE["OPD_BILL"]).get(band) or [])
    fields: list[dict[str, Any]] = []
    index = _catalog_index()
    ordered_ids = list((_VISIBLE.get(code) or {}).get(band) or [])
    seen: set[str] = set()
    for fid in ordered_ids:
        row = index.get((band, fid))
        if not row:
            continue
        seen.add(fid)
        fields.append(
            _clean_field(
                {
                    "id": fid,
                    "band": band,
                    "visible": True,
                    "label": row["label"],
                    "align": row.get("align") or ("center" if band == "header" else "left"),
                    "width": row.get("width"),
                    "text": _TEXT_DEFAULTS.get(fid),
                },
                row,
            )
        )
    if code not in _BILL_CODES:
        return [field for field in fields if field]
    for row in BILL_CATALOG:
        if row["band"] != band or row["id"] in seen:
            continue
        if row["id"] in visible:
            continue
        fields.append(
            _clean_field(
                {
                    "id": row["id"],
                    "band": band,
                    "visible": False,
                    "label": row["label"],
                    "align": row.get("align") or "left",
                    "width": row.get("width"),
                    "text": _TEXT_DEFAULTS.get(row["id"]),
                },
                row,
            )
        )
    return [field for field in fields if field]


def _merge_band(code: str, band: str, saved: Any) -> list[dict[str, Any]]:
    index = _catalog_index()
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    if isinstance(saved, list):
        for raw in saved:
            if not isinstance(raw, dict):
                continue
            fid = str(raw.get("id") or "")
            catalog_row = index.get((band, fid))
            if fid.startswith("static_"):
                raw = {**raw, "band": band}
                cleaned = _clean_field(raw, {"id": fid, "label": raw.get("label") or "Text", "band": band})
            else:
                cleaned = _clean_field({**raw, "band": band}, catalog_row)
            if not cleaned or cleaned["id"] in seen:
                continue
            seen.add(cleaned["id"])
            merged.append(cleaned)
    for field in _default_band(code, band):
        if field["id"] in seen:
            continue
        hidden = {**field, "visible": False}
        merged.append(hidden)
    return merged


def _empty_formats(code: str) -> dict[str, dict[str, list[dict[str, Any]]]]:
    band_layout = {band: _default_band(code, band) for band in BANDS}
    return {fmt: deepcopy(band_layout) for fmt in STANDARD_PAGES}


def default_document_layout(code: str) -> dict[str, Any]:
    code_u = layout_family(code)
    return {
        "version": LAYOUT_VERSION,
        "kind": KIND_BILL,
        "designed": False,
        "active_format": "A4",
        "formats": _empty_formats(code_u),
        "custom_pages": {},
        "page": {
            fmt: {"orientation": "landscape" if code_u in _LANDSCAPE_CODES else "portrait"}
            for fmt in STANDARD_PAGES
        },
    }


def custom_pages_of(layout: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    raw = (layout or {}).get("custom_pages") or {}
    pages: dict[str, dict[str, Any]] = {}
    if not isinstance(raw, dict):
        return pages
    for key, value in raw.items():
        code = str(key or "").strip().upper()
        if not code.startswith("CUSTOM_") or not isinstance(value, dict):
            continue
        try:
            width = float(value.get("width_mm") or value.get("widthMm") or 0)
            height = float(value.get("height_mm") or value.get("heightMm") or 0)
        except (TypeError, ValueError):
            continue
        if width < 40 or height < 40 or width > 1000 or height > 1000:
            continue
        pages[code] = {
            "name": str(value.get("name") or code)[:80],
            "width_mm": round(width, 1),
            "height_mm": round(height, 1),
        }
    return pages


def _shared_page_format(raw_format: Any) -> dict[str, list[Any]] | None:
    if not isinstance(raw_format, dict):
        return None
    cleaned: dict[str, list[Any]] = {}
    found = False
    for band in BANDS:
        rows = raw_format.get(band)
        if isinstance(rows, list) and rows:
            cleaned[band] = rows
            found = True
        else:
            cleaned[band] = []
    return cleaned if found else None


# Everything that makes one custom page print the same on every document.
_SHARED_PAGE_KEYS = (
    "orientation",
    "margin_top_mm",
    "margin_right_mm",
    "margin_bottom_mm",
    "margin_left_mm",
    "border",
    "free_place",
    "y_origin",
    "trim_to_content",
    "fit_detail",
    "detail_boxes",
    "shapes",
)


def shared_page_settings(meta: Any) -> dict[str, Any]:
    """Placement, margins, lines, and shapes saved for one custom page."""
    source = meta if isinstance(meta, dict) else {}
    settings: dict[str, Any] = {}
    for key in _SHARED_PAGE_KEYS:
        if key not in source:
            continue
        settings[key] = deepcopy(source[key])
    orientation = str(settings.get("orientation") or "portrait").lower()
    settings["orientation"] = "landscape" if orientation == "landscape" else "portrait"
    return settings


def collect_shared_pages(entries: list[tuple[str, Any]]) -> dict[str, dict[str, Any]]:
    """Custom pages already saved on any bill, newest layout first.

    Choosing that page on another bill uses this same size, field layout,
    and page setup. Field layout is included only when the source is a bill.
    """
    shared: dict[str, dict[str, Any]] = {}
    for doc_code, raw in entries:
        if not isinstance(raw, dict) or not raw.get("designed"):
            continue
        is_bill = layout_family(str(doc_code or "")) in _BILL_CODES
        formats = raw.get("formats") if isinstance(raw.get("formats"), dict) else {}
        page_meta = raw.get("page") if isinstance(raw.get("page"), dict) else {}
        for page_code, page in custom_pages_of(raw).items():
            meta = page_meta.get(page_code) if isinstance(page_meta, dict) else None
            settings = shared_page_settings(meta)
            band_format = _shared_page_format(formats.get(page_code)) if is_bill else None
            current = shared.get(page_code)
            if current is None:
                shared[page_code] = {
                    "name": page["name"],
                    "width_mm": page["width_mm"],
                    "height_mm": page["height_mm"],
                    "orientation": settings["orientation"],
                    "format": band_format,
                    "page": settings,
                }
                continue
            if current.get("format") is None and band_format is not None:
                current["format"] = band_format
                current["page"] = settings
                current["orientation"] = settings["orientation"]
    return shared


def apply_shared_pages(layout: dict[str, Any] | None, shared: dict[str, Any] | None) -> dict[str, Any] | None:
    """Use the saved page design wherever that page is selected."""
    if not isinstance(layout, dict) or not shared:
        return layout
    raw_pages = layout.get("custom_pages")
    if not isinstance(raw_pages, dict):
        return layout
    updated = deepcopy(layout)
    formats = updated.get("formats") if isinstance(updated.get("formats"), dict) else {}
    page_meta = updated.get("page") if isinstance(updated.get("page"), dict) else {}
    updated["formats"] = formats
    updated["page"] = page_meta
    for code in list(raw_pages):
        key = str(code or "").strip().upper()
        source = shared.get(key)
        if not isinstance(source, dict):
            continue
        band_format = source.get("format")
        if isinstance(band_format, dict):
            formats[key] = deepcopy(band_format)
            if code != key and code in formats:
                formats.pop(code, None)
        settings = source.get("page")
        if isinstance(settings, dict) and settings:
            page_meta[key] = deepcopy(settings)
            if code != key and code in page_meta:
                page_meta.pop(code, None)
    return updated


_SHAPE_KINDS = {"line", "rect", "square", "ellipse", "triangle", "diamond", "round"}


def _clean_shapes(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    shapes: list[dict[str, Any]] = []
    for item in raw[:80]:
        if not isinstance(item, dict):
            continue
        try:
            x = float(item.get("x_mm") or 0)
            y = float(item.get("y_mm") or 0)
            length = float(item.get("length_mm") or 20)
            width = float(item.get("width_mm") or length)
            height = float(item.get("height_mm") or width)
        except (TypeError, ValueError):
            continue
        kind = str(item.get("kind") or "line")
        if kind not in _SHAPE_KINDS:
            kind = "line"
        try:
            rotate = float(item.get("rotate_deg") or 0) % 360
        except (TypeError, ValueError):
            rotate = 0.0
        shapes.append(
            {
                "id": str(item.get("id") or f"line_{len(shapes) + 1}")[:40],
                "kind": kind,
                "axis": "v" if str(item.get("axis") or "") == "v" else "h",
                "x_mm": round(max(0.0, min(1000.0, x)), 1),
                "y_mm": round(max(0.0, min(1000.0, y)), 1),
                "length_mm": round(max(2.0, min(1000.0, length)), 1),
                "width_mm": round(max(2.0, min(1000.0, width)), 1),
                "height_mm": round(max(2.0, min(1000.0, height)), 1),
                "mode": "content" if str(item.get("mode") or "") == "content" else "fixed",
                "field_id": str(item.get("field_id") or "")[:40],
                "repeat": "detail" if str(item.get("repeat") or "") == "detail" else "",
                "rotate_deg": round(rotate, 1),
            }
        )
    return shapes


def page_insets(layout: dict[str, Any] | None, bill_format: str | None) -> tuple[float, float, float, float, bool]:
    """Top, right, bottom, left margins in mm, and whether a border is printed."""
    fmt = resolve_format(layout, bill_format)
    meta = ((layout or {}).get("page") or {}).get(fmt) or {}
    if not isinstance(meta, dict):
        meta = {}

    def number(key: str) -> float:
        if meta.get(key) is None:
            return 5.0
        try:
            return round(max(0.0, min(40.0, float(meta.get(key)))), 1)
        except (TypeError, ValueError):
            return 5.0

    return (
        number("margin_top_mm"),
        number("margin_right_mm"),
        number("margin_bottom_mm"),
        number("margin_left_mm"),
        bool(meta.get("border")),
    )


def paper_mm(layout: dict[str, Any] | None, bill_format: str | None) -> tuple[float, float]:
    fmt = (bill_format or "A4").upper()
    pages = custom_pages_of(layout)
    if fmt in pages:
        page = pages[fmt]
        return page["width_mm"], page["height_mm"]
    if fmt in STANDARD_PAGES:
        _name, width, height = STANDARD_PAGES[fmt]
        return width, height
    return STANDARD_PAGES["A4"][1], STANDARD_PAGES["A4"][2]


def resolve_format(layout: dict[str, Any] | None, bill_format: str | None) -> str:
    pages = custom_pages_of(layout)
    candidates: list[str] = []
    if bill_format:
        candidates.append(str(bill_format).strip().upper())
    active = str((layout or {}).get("active_format") or "").strip().upper()
    if active:
        candidates.append(active)
    for fmt in candidates:
        if fmt in STANDARD_PAGES or fmt in pages:
            return fmt
        if fmt == "CUSTOM":
            if len(pages) == 1:
                return next(iter(pages))
            if active in pages:
                return active
    return "A4"


def normalize_layout(code: str, raw: Any) -> dict[str, Any]:
    code_u = layout_family(code)
    base = default_document_layout(code_u)
    if not isinstance(raw, dict):
        return base
    designed = bool(raw.get("designed"))
    custom_pages = custom_pages_of(raw)
    formats_in = raw.get("formats") if isinstance(raw.get("formats"), dict) else {}
    formats: dict[str, dict[str, list[dict[str, Any]]]] = {}
    page_meta_in = raw.get("page") if isinstance(raw.get("page"), dict) else {}
    page_meta: dict[str, dict[str, Any]] = {}
    keys = list(STANDARD_PAGES.keys()) + list(custom_pages.keys())
    for fmt in keys:
        saved = formats_in.get(fmt) if isinstance(formats_in.get(fmt), dict) else {}
        formats[fmt] = {band: _merge_band(code_u, band, saved.get(band)) for band in BANDS}
        meta = page_meta_in.get(fmt) if isinstance(page_meta_in.get(fmt), dict) else {}
        orientation = "portrait"
        if str(meta.get("orientation") or "").lower() == "landscape":
            orientation = "landscape"

        def _margin(key: str) -> float:
            if meta.get(key) is None:
                return 5.0
            try:
                return round(max(0.0, min(40.0, float(meta.get(key)))), 1)
            except (TypeError, ValueError):
                return 5.0

        page_meta[fmt] = {
            "orientation": orientation,
            "margin_top_mm": _margin("margin_top_mm"),
            "margin_right_mm": _margin("margin_right_mm"),
            "margin_bottom_mm": _margin("margin_bottom_mm"),
            "margin_left_mm": _margin("margin_left_mm"),
            "border": bool(meta.get("border")),
            "free_place": bool(meta.get("free_place")),
            "y_origin": "page" if meta.get("y_origin") == "page" else "",
            "trim_to_content": bool(meta.get("trim_to_content")),
            "fit_detail": bool(meta.get("fit_detail")),
            "detail_boxes": meta.get("detail_boxes") is not False,
            "shapes": _clean_shapes(meta.get("shapes")),
        }
    active = str(raw.get("active_format") or "").strip().upper()
    if active not in STANDARD_PAGES and active not in custom_pages:
        active = "A4"
    return {
        "version": LAYOUT_VERSION,
        "kind": KIND_BILL,
        "designed": designed,
        "active_format": active,
        "formats": formats,
        "custom_pages": custom_pages,
        "page": page_meta,
    }


def layout_for_format(layout: dict[str, Any], bill_format: str | None) -> dict[str, list[dict[str, Any]]]:
    fmt = resolve_format(layout, bill_format)
    formats = layout.get("formats") or {}
    band = formats.get(fmt) or formats.get("A4") or {}
    return {name: list(band.get(name) or []) for name in BANDS}


def sample_context(code: str) -> dict[str, Any]:
    code = layout_family(code)
    lines = [
        {"sr": 1, "code": "CON", "name": "Consultation", "category": "OPD", "rate": "500.00", "qty": 1, "amount": "500.00"},
        {"sr": 2, "code": "CBC", "name": "Complete Blood Count", "category": "Lab", "rate": "350.00", "qty": 1, "amount": "350.00"},
    ]
    if code in {"PHARMACY_SALE_BILL", "PHARMACY_PURCHASE_BILL"}:
        lines = [
            {"sr": 1, "code": "PCM", "name": "Paracetamol 500", "category": "B001", "rate": "2.00", "qty": 10, "amount": "20.00"},
        ]
    if code == "ADVANCE_RECEIPT":
        lines = []
    ctx = {
        "hospital_name": "City Care Hospital",
        "hospital_address": "12 Main Road, Sample City",
        "hospital_phone": "080-4000-1000",
        "hospital_mobile": "98765-43210",
        "hospital_email": "billing@hospital.example",
        "hospital_gstin": "29AAAAA0000A1Z5",
        "hospital_registration_number": "REG-KA-12345",
        "hospital_website": "www.hospital.example",
        "hospital_software_id": "HMS-001",
        "bill_title": DOCUMENT_NAMES.get(code, "Bill"),
        "patient_no": "P00021",
        "patient_name": "Anita Rao",
        "patient_age": "34",
        "patient_gender": "Female",
        "doctor_name": "Dr Sharma",
        "referring_doctor": "Dr Iyer",
        "department_name": "General Medicine",
        "bill_no": "OP-1042",
        "bill_date": "23/09/2026",
        "voucher_no": "ADV-18",
        "voucher_date": "23/09/2026",
        "admission_no": "IP-220",
        "ward_name": "General",
        "bed_no": "12",
        "ward_bed": "General / 12",
        "stay_days": 3,
        "admission_date": "20/09/2026",
        "discharge_date": "23/09/2026",
        "scheme": "General",
        "cash_credit": "Cash",
        "token_number": "7",
        "sample_no": "S-88",
        "visit_category": "OPD",
        "gross_amount": "850.00",
        "admin_charges": "0.00",
        "scheme_discount": "50.00",
        "adjust_advance": "200.00",
        "net_amount": "600.00",
        "receipt_amount": "5,000.00",
        "amount": "5,000.00",
        "balance_after": "5,000.00",
        "payment_mode": "Cash",
        "payments": [{"mode": "Cash", "amount": "600.00"}],
        "remarks": "Sample preview",
        "lines": lines,
    }
    from erp_core.product_config import get_product_name, label, load_product_config

    if get_product_name() != "hospital":
        ctx["hospital_name"] = str(load_product_config().get("display_name") or label("company", "Company"))
        ctx["hospital_email"] = "billing@example.com"
        ctx["hospital_website"] = "www.example.com"
        ctx["hospital_software_id"] = ""
        ctx["patient_no"] = "C00021"
        ctx["patient_name"] = f"Sample {label('party', 'Party')}"
        ctx["doctor_name"] = ""
        ctx["referring_doctor"] = ""
        ctx["department_name"] = ""
        ctx["visit_category"] = ""
        for line in ctx["lines"]:
            if str(line.get("category") or "").upper() == "OPD":
                line["category"] = "General"
            if "blood" in str(line.get("name") or "").lower():
                line["name"] = "Sample item"
                line["code"] = "ITEM"
    return ctx
