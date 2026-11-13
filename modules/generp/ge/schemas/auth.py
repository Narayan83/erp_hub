from pydantic import BaseModel, Field

from modules.generp.ge.schemas.menu import MenuTreeNode


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=1)  # user id or email
    password: str = Field(..., min_length=4)


class UserInfo(BaseModel):
    id: str
    username: str | None = None
    email: str
    full_name: str
    phone: str | None = None
    roles: list[str]
    user_type_sort_order: int | None = None


class TokenRefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    idle_timeout_minutes: int = 5


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo
    menus: list[MenuTreeNode]
    app_data: dict
    idle_timeout_minutes: int = 5
