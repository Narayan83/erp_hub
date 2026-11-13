from pydantic import BaseModel


class MenuPermissions(BaseModel):
    can_view: bool = False
    can_create: bool = False
    can_update: bool = False
    can_delete: bool = False


class MenuTreeNode(BaseModel):
    id: str
    code: str
    label: str
    icon: str | None = None
    sort_order: int = 0
    legacy_mcode: int | None = None
    legacy_form: str | None = None
    parameters: str | None = None
    permissions: MenuPermissions = MenuPermissions()
    children: list["MenuTreeNode"] = []


MenuTreeNode.model_rebuild()
