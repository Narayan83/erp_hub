from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from modules.hospital.hms.api.deps import get_current_user, get_session
from modules.hospital.hms.models.user import User
from modules.hospital.hms.schemas.single_service_opd import (
    SingleServiceOpdBillCreate,
    SingleServiceOpdBillRead,
    SingleServiceOpdBillReportRead,
    SingleServiceOpdBillUpdate,
    SingleServiceOpdOptionCreate,
    SingleServiceOpdOptionRead,
    SingleServiceOpdOptionReorder,
    SingleServiceOpdOptionUpdate,
    SingleServiceOpdUnlinkedMenuRead,
)
from modules.hospital.hms.services.single_service_opd import SingleServiceOpdService

router = APIRouter()


@router.get("/options", response_model=list[SingleServiceOpdOptionRead])
async def list_options(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await SingleServiceOpdService(session).list_options()


@router.get("/options/unlinked-menus", response_model=list[SingleServiceOpdUnlinkedMenuRead])
async def list_unlinked_menus(
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await SingleServiceOpdService(session).list_unlinked_menus()


@router.get("/options/by-menu/{menu_code}", response_model=SingleServiceOpdOptionRead)
async def get_option_by_menu(
    menu_code: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await SingleServiceOpdService(session).get_option_by_menu(menu_code)


@router.post("/options", response_model=SingleServiceOpdOptionRead, status_code=201)
async def create_option(
    data: SingleServiceOpdOptionCreate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await SingleServiceOpdService(session).create_option(data)
    await session.commit()
    return result


@router.put("/options/reorder", response_model=list[SingleServiceOpdOptionRead])
async def reorder_options(
    data: SingleServiceOpdOptionReorder,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await SingleServiceOpdService(session).reorder_options(data.option_ids)
    await session.commit()
    return result


@router.patch("/options/{option_id}", response_model=SingleServiceOpdOptionRead)
async def update_option(
    option_id: str,
    data: SingleServiceOpdOptionUpdate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await SingleServiceOpdService(session).update_option(option_id, data)
    await session.commit()
    return result


@router.delete("/options/{option_id}", response_model=SingleServiceOpdOptionRead)
async def delete_option(
    option_id: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await SingleServiceOpdService(session).delete_option(option_id)
    await session.commit()
    return result


@router.get("/bills/search", response_model=list[SingleServiceOpdBillRead])
async def search_bills(
    option_id: str = Query(...),
    q: str = Query(..., min_length=1),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await SingleServiceOpdService(session).search_bills(option_id=option_id, query=q)


@router.get("/bills/report", response_model=SingleServiceOpdBillReportRead)
async def bill_report(
    option_id: str = Query(...),
    from_date: date = Query(...),
    to_date: date = Query(...),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await SingleServiceOpdService(session).build_report(
        option_id=option_id,
        from_date=from_date,
        to_date=to_date,
    )


@router.get("/bills", response_model=list[SingleServiceOpdBillRead])
async def list_bills(
    option_id: str = Query(...),
    bill_date: date = Query(...),
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await SingleServiceOpdService(session).list_bills(option_id, bill_date)


@router.post("/bills", response_model=SingleServiceOpdBillRead, status_code=201)
async def create_bill(
    data: SingleServiceOpdBillCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await SingleServiceOpdService(session).create_bill(data, user_id=user.id)
    await session.commit()
    return result


@router.get("/bills/{bill_id}", response_model=SingleServiceOpdBillRead)
async def get_bill(
    bill_id: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await SingleServiceOpdService(session).get_bill(bill_id)


@router.patch("/bills/{bill_id}", response_model=SingleServiceOpdBillRead)
async def update_bill(
    bill_id: str,
    data: SingleServiceOpdBillUpdate,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await SingleServiceOpdService(session).update_bill(bill_id, data)
    await session.commit()
    return result


@router.delete("/bills/{bill_id}", response_model=SingleServiceOpdBillRead)
async def cancel_bill(
    bill_id: str,
    _: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await SingleServiceOpdService(session).cancel_bill(bill_id)
    await session.commit()
    return result
