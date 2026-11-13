export type Partner = {
  id: string
  name: string
  phone: string
  email: string
  address: string
  notes: string
  is_active: boolean
}

export type Location = {
  id: string
  name: string
  address: string
  village: string
  taluk: string
  district: string
  state: string
  pin: string
  contact_name: string
  contact_number: string
  notes: string
  is_active: boolean
}

export type Phase = {
  id: string
  code: string
  name: string
  description: string
  start_date: string
  end_date: string
  is_active: boolean
}

export type WorkType = {
  id: string
  code: string
  name: string
  description: string
  is_active: boolean
}

export type Labour = {
  id: string
  name: string
  phone: string
  address: string
  role: string
  daily_rate: string
  notes: string
  is_active: boolean
}

export type Vendor = {
  id: string
  name: string
  phone: string
  email: string
  address: string
  gstin: string
  notes: string
  is_active: boolean
}

export type Ledger = {
  id: string
  code: string
  name: string
  group_name: string
  ledger_type: string
  opening_balance: string
  notes: string
  is_active: boolean
  balance?: number | string | null
}

export type PaymentMode = {
  id: string
  code: string
  name: string
  entry_type: 'credit' | 'debit' | string
  notes: string
  is_active: boolean
}

export type Project = {
  id: string
  name: string
  address: string
  location_id: string | null
  location_name?: string | null
  description: string
  start_date: string
  end_date: string
  is_active: boolean
  partner_ids: string[]
  partners: { id: string; name: string }[]
}

export type Transaction = {
  id: string
  project_id: string
  project_name?: string | null
  phase_id: string
  phase_name?: string | null
  work_type_id: string
  work_type_name?: string | null
  ledger_id: string
  ledger_name?: string | null
  payment_mode_id: string
  payment_mode_name?: string | null
  party_type: string
  labour_id?: string | null
  partner_id?: string | null
  vendor_id?: string | null
  party_name?: string | null
  txn_date: string
  amount: number | string
  entry_type: string
  narration: string
  reference: string
}

export type Balance = {
  entity: string
  entity_id: string | null
  name: string
  credit_total: number | string
  debit_total: number | string
  balance: number | string
}

export type ReportSummary = {
  project_id: string | null
  project_name: string
  phase_id?: string | null
  phase_name?: string | null
  receipts: number | string
  payments: number | string
  balance: number | string
  txn_count: number
}

export type ChartPoint = { label: string; value: number | string; series: string }
export type Charts = {
  by_phase: ChartPoint[]
  by_work_type: ChartPoint[]
  by_partner: ChartPoint[]
  receipts_vs_payments: ChartPoint[]
}
