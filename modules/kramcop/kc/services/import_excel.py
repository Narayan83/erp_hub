from __future__ import annotations

from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.kramcop.kc.kramcop_env import resolve_data_dir
from modules.kramcop.kc.models.member import Member, Transaction
from modules.kramcop.kc.services.nudi import nudi_to_unicode
from modules.kramcop.kc.services.shares import classify_imported, normalize_share_no


def _clean(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text in ("\\N", "None", "NULL"):
        return ""
    return text


def _int(value) -> int | None:
    if value is None or value == "" or str(value).strip() in ("\\N", "None"):
        return None
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None


def _kn(value) -> str:
    return nudi_to_unicode(_clean(value))


def _en(value) -> str:
    return " ".join(_clean(value).split())


def default_excel_path() -> Path:
    return resolve_data_dir() / "kram.xlsx"


async def import_workbook(session: AsyncSession, path: Path | None = None) -> dict:
    path = path or default_excel_path()
    if not path.is_file():
        return {"members": 0, "transactions": 0, "skipped": True, "path": str(path)}

    wb = load_workbook(path, read_only=True, data_only=True)

    member_count = 0
    if "member" in wb.sheetnames:
        ws = wb["member"]
        rows = ws.iter_rows(values_only=True)
        headers = [str(h).strip().lower() if h else "" for h in next(rows)]
        existing = {
            row[0]
            for row in (
                await session.execute(select(Member.acno))
            ).all()
        }
        batch: list[Member] = []
        for row in rows:
            rec = dict(zip(headers, row))
            acno = _int(rec.get("acno"))
            if acno is None or acno in existing:
                continue
            existing.add(acno)
            batch.append(
                Member(
                    acno=acno,
                    shac=_clean(rec.get("shac")),
                    share_no=_clean(rec.get("shac")),
                    first_en=_en(rec.get("frst")),
                    first_kn=_kn(rec.get("kfrst")),
                    second_en=_en(rec.get("send")),
                    second_kn=_kn(rec.get("ksend")),
                    third_en=_en(rec.get("thrd")),
                    third_kn=_kn(rec.get("kthrd")),
                    village_en=_en(rec.get("vilg")),
                    village_kn=_kn(rec.get("kvilg")),
                    post_en=_en(rec.get("post")),
                    post_kn=_kn(rec.get("kpost")),
                    taluk_en=_en(rec.get("tlka")),
                    taluk_kn=_kn(rec.get("ktlka")),
                    dist_en=_en(rec.get("dist")),
                    dist_kn=_kn(rec.get("kdist")),
                    pin=_clean(rec.get("pin")),
                    category=_clean(rec.get("catg")),
                    sex=_clean(rec.get("sex")),
                    mobile=_clean(rec.get("mob")),
                )
            )
            if len(batch) >= 400:
                session.add_all(batch)
                await session.flush()
                member_count += len(batch)
                batch = []
        if batch:
            session.add_all(batch)
            await session.flush()
            member_count += len(batch)

    txn_count = 0
    if "Transaction" in wb.sheetnames:
        existing_txn = (await session.execute(select(func.count(Transaction.id)))).scalar() or 0
        if existing_txn == 0:
            acno_ids = {
                acno: mid
                for acno, mid in (await session.execute(select(Member.acno, Member.id))).all()
            }
            ws = wb["Transaction"]
            rows = ws.iter_rows(values_only=True)
            headers = [str(h).strip().lower() if h else "" for h in next(rows)]
            batch_t: list[Transaction] = []
            for row in rows:
                rec = dict(zip(headers, row))
                acno = _int(rec.get("acno"))
                if acno is None:
                    continue
                raw_date = rec.get("date1")
                txn_date = None
                if isinstance(raw_date, datetime):
                    txn_date = raw_date.date()
                elif isinstance(raw_date, date):
                    txn_date = raw_date
                amount = rec.get("amnt") or 0
                try:
                    amount_f = float(amount)
                except (TypeError, ValueError):
                    amount_f = 0
                typ = _int(rec.get("typ"))
                drcr = _int(rec.get("drcr"))
                batch_t.append(
                    Transaction(
                        member_id=acno_ids.get(acno),
                        acno=acno,
                        typ=typ,
                        astyp=_clean(rec.get("astyp")),
                        txn_date=txn_date,
                        rno=normalize_share_no(rec.get("rno")),
                        amount=amount_f,
                        drcr=drcr,
                        kind=classify_imported(typ, drcr),
                    )
                )
                if len(batch_t) >= 500:
                    session.add_all(batch_t)
                    await session.flush()
                    txn_count += len(batch_t)
                    batch_t = []
            if batch_t:
                session.add_all(batch_t)
                await session.flush()
                txn_count += len(batch_t)

    wb.close()
    return {"members": member_count, "transactions": txn_count, "skipped": False, "path": str(path)}
