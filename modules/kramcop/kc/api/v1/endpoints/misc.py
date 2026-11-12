from fastapi import APIRouter, Depends

from modules.kramcop.kc.core.security import get_current_user
from modules.kramcop.kc.models.auth import User
from modules.kramcop.kc.schemas import TransliterateRequest, TransliterateResponse
from modules.kramcop.kc.services.nudi import nudi_to_unicode
from modules.kramcop.kc.services.transliterate import english_to_kannada

router = APIRouter()


@router.post("/transliterate", response_model=TransliterateResponse)
async def transliterate(data: TransliterateRequest, _user: User = Depends(get_current_user)):
    if data.mode == "nudi":
        return TransliterateResponse(text=nudi_to_unicode(data.text))
    return TransliterateResponse(text=english_to_kannada(data.text))
