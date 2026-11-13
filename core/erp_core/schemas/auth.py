from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)


class UserInfo(BaseModel):
    id: str
    username: str | None = None
    email: str
    full_name: str
    phone: str | None = None
    roles: list[str] = []


class MenuNode(BaseModel):
    code: str
    label: str
    children: list["MenuNode"] = []


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo
    menus: list[MenuNode] = []
    product: str
    display_name: str
    labels: dict[str, str] = {}
    idle_timeout_minutes: int = 5


class TokenRefreshResponse(BaseModel):
    access_token: str
    idle_timeout_minutes: int = 5
