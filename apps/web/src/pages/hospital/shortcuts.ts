export const HOSPITAL_SHORTCUTS_CHANGED = 'hospital-shortcuts-changed'

export function notifyHospitalShortcutsChanged() {
  window.dispatchEvent(new Event(HOSPITAL_SHORTCUTS_CHANGED))
}

export type HospitalMenu = { code: string; label: string; picker_label?: string }

/** Button text for a picked menu. Duplicate labels use a clearer picker name. */
export function shortcutButtonName(menu: HospitalMenu) {
  const picker = (menu.picker_label || '').trim()
  if (picker && !picker.includes('/') && !picker.includes('(')) return picker
  return menu.label
}

export const SHORTCUTS_API = '/dashboard/shortcuts'
export const SHORTCUT_MENUS_API = '/dashboard/shortcut-menus'

export type HospitalShortcut = {
  id: string
  host_code?: string
  module_code: string
  button_label: string
  description?: string | null
  sort_order: number
  is_active: boolean
}

export const SHORTCUT_HIDDEN_HOSTS = new Set(['dashboard_shortcut_setup', 'print_template_designer'])
