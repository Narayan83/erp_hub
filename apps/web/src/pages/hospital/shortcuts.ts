export const HOSPITAL_SHORTCUTS_CHANGED = 'hospital-shortcuts-changed'

export function notifyHospitalShortcutsChanged() {
  window.dispatchEvent(new Event(HOSPITAL_SHORTCUTS_CHANGED))
}

export type HospitalMenu = { code: string; label: string }

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
