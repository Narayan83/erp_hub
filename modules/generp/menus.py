"""Full GenERP menu tree from the original product. Not a hospital menu."""

from modules.generp.ge.seeds.menu_definitions import MENU_DEFINITIONS

MENUS: list[tuple[str, str, str | None, int]] = [
    (code, label, parent_code, sort_order)
    for code, label, parent_code, sort_order, *_rest in MENU_DEFINITIONS
]
GENERP_MENUS = MENUS
