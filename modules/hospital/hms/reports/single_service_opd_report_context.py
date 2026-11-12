from typing import Any

from modules.hospital.hms.reports.bill_context import _fmt_date, _fmt_money
from modules.hospital.hms.schemas.single_service_opd import SingleServiceOpdBillRead, SingleServiceOpdBillReportRead


def build_single_service_opd_report_context(report: SingleServiceOpdBillReportRead) -> dict[str, Any]:
    return {
        "report_title": report.option_name.upper(),
        "billing_type_label": report.option_name,
        "period_label": (
            f"FROM {_fmt_date(report.from_date)} TO {_fmt_date(report.to_date)}"
        ),
        "rows": [
            {
                "serial_no": row.serial_no,
                "bill_date": _fmt_date(row.bill_date),
                "patient_name": row.patient_name,
                "amount": _fmt_money(row.amount),
            }
            for row in report.rows
        ],
        "grand_total": _fmt_money(report.grand_total),
        "has_rows": bool(report.rows),
    }


def build_single_service_opd_receipt_context(bill: SingleServiceOpdBillRead) -> dict[str, Any]:
    amount = _fmt_money(bill.rate)
    title = (bill.option_name or "Bill").upper()
    source = bill.services or []
    if source:
        lines = [
            {
                "sr": index,
                "name": row.service_name,
                "rate": _fmt_money(row.rate),
                "qty": "1",
                "amount": _fmt_money(row.rate),
            }
            for index, row in enumerate(source, start=1)
        ]
    else:
        lines = [
            {
                "sr": 1,
                "name": bill.service_name,
                "rate": amount,
                "qty": "1",
                "amount": amount,
            }
        ]
    return {
        "bill_title": title,
        "bill_no": bill.bill_no,
        "bill_date": _fmt_date(bill.bill_date),
        "patient_no": bill.patient_no or "—",
        "patient_name": bill.patient_name,
        "department_name": bill.option_name or "—",
        "doctor_name": (bill.doctor_name or "").strip(),
        "lines": lines,
        "admin_charges": "0.00",
        "scheme_discount": "0.00",
        "adjust_advance": "0.00",
        "gross_amount": amount,
        "net_amount": amount,
        "payment_mode": bill.payment_mode_name or "Cash",
        "payments": [],
        "remarks": "",
    }
