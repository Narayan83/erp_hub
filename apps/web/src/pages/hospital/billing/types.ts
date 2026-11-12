export type Patient = {
  id: string
  patient_no: string
  full_name: string
  mobile?: string | null
  phone?: string | null
  first_name?: string
  middle_name?: string | null
  last_name?: string | null
  gender?: string
}

export type Doctor = {
  id: string
  doctor_code: string
  full_name: string
  department_id?: string | null
}

export type Department = { id: string; code: string; name: string }
export type Ward = { id: string; code: string; name: string }
export type PayMode = { id: string; code: string; name: string; is_cash?: boolean }

export type CatalogService = {
  id: string
  code: string
  name: string
  rate: number | string
  service_charge?: number | string
  category_id?: string | null
  category_name?: string | null
  sub_category_name?: string | null
}

export type BillLine = {
  key: string
  service_id: string
  service_code: string
  service_name: string
  category_name?: string | null
  quantity: number
  rate: number
}

export type PaymentRow = {
  key: string
  payment_mode_id: string
  amount: number
  document_no?: string
}

export type Page<T> = { items: T[]; total?: number; page?: number; pages?: number }

export type OpdBillSummary = {
  id: string
  bill_no: string
  bill_date: string
  patient_no?: string
  doctor_name?: string | null
  department_name?: string | null
  net_amount: number | string
  gross_amount?: number | string
  token_number?: number | null
  visit_category?: string | null
  payment_mode_name?: string | null
  status?: string
}

export type OpdBillDetail = OpdBillSummary & {
  patient_id: string
  patient_name?: string
  doctor_id?: string | null
  department_id?: string | null
  payment_mode_id?: string | null
  token_session?: string | null
  appointment_date?: string | null
  scheme?: string | null
  adjust_advance?: number | string
  admin_charges?: number | string
  scheme_discount?: number | string
  remarks?: string | null
  lines: Array<{
    id: string
    service_id?: string | null
    service_code: string
    service_name: string
    category_name?: string | null
    rate: number | string
    quantity: number
    amount: number | string
  }>
  payments?: Array<{
    payment_mode_id: string
    amount: number | string
    document_no?: string | null
  }>
}

export type Admission = {
  id: string
  admission_no: string
  admission_date: string
  patient_id: string
  patient_no?: string
  patient_name?: string
  ward_id?: string | null
  ward_name?: string | null
  bed_no?: string | null
  doctor_id?: string | null
  doctor_name?: string | null
  department_id?: string | null
  advance_amount?: number | string
  diagnosis?: string | null
  status?: string
}

export type IpdBillSummary = {
  id: string
  bill_no: string
  bill_date: string
  admission_no?: string | null
  doctor_name?: string | null
  ward_name?: string | null
  net_amount: number | string
  gross_amount?: number | string
  scheme_discount?: number | string
  discharge_date?: string
  stay_days?: number
  payment_mode_name?: string | null
}

export type IpdBillDetail = IpdBillSummary & {
  patient_id: string
  patient_no?: string
  patient_name?: string
  admission_id?: string | null
  doctor_id?: string | null
  ward_id?: string | null
  bed_no?: string | null
  admission_date?: string
  payment_mode_id?: string | null
  scheme?: string | null
  adjust_advance?: number | string
  hide_advance_on_bill?: boolean
  remarks?: string | null
  lines: Array<{
    id: string
    service_id?: string | null
    service_code: string
    service_name: string
    category_name?: string | null
    rate: number | string
    quantity: number
    amount: number | string
  }>
  payments?: Array<{
    payment_mode_id: string
    amount: number | string
    document_no?: string | null
  }>
}

export function money(v: number | string | null | undefined): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function defaultSession(): 'morning' | 'evening' {
  return new Date().getHours() < 12 ? 'morning' : 'evening'
}

export function uid(prefix = 'r'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}
