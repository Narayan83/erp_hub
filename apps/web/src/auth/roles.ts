export const SUPER_ADMIN_ROLE = 'Super Admin'

export function isSuperAdmin(user: { roles?: string[] } | null | undefined): boolean {
  return Boolean(user?.roles?.includes(SUPER_ADMIN_ROLE))
}

export type MenuLike = { code?: string; children?: MenuLike[] }

export function menuTreeHasCode(menus: MenuLike[] | undefined, code: string): boolean {
  if (!menus?.length) return false
  for (const node of menus) {
    if (node.code === code) return true
    if (menuTreeHasCode(node.children, code)) return true
  }
  return false
}

/** Super Admin, or any role that can open Print Template Designer. */
export function canEditPrintTemplates(
  user: { roles?: string[] } | null | undefined,
  menus?: MenuLike[],
): boolean {
  return isSuperAdmin(user) || menuTreeHasCode(menus, 'print_template_designer')
}
