from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from modules.generp.ge.api.deps import get_current_user, get_session
from modules.generp.ge.models.auth import User
from modules.generp.ge.schemas.transactions import DocumentNumberRuleOut, DocumentNumberRulesSave
from modules.generp.ge.services.document_numbers import list_number_rules, save_number_rules

router = APIRouter()


@router.get("", response_model=list[DocumentNumberRuleOut])
async def get_rules(
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await list_number_rules(session)


@router.put("", response_model=list[DocumentNumberRuleOut])
async def put_rules(
    data: DocumentNumberRulesSave,
    _u: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await save_number_rules(
        session, [item.model_dump() for item in data.rules]
    )
