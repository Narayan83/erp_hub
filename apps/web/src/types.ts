export type MenuNode = {
  code: string
  label: string
  children?: MenuNode[]
}

export type User = {
  id: string
  username?: string | null
  email: string
  full_name: string
  phone?: string | null
  roles: string[]
}

export type Labels = {
  party: string
  party_plural: string
  party_code: string
  company: string
  deposit: string
}

export type LoginResponse = {
  access_token: string
  token_type: string
  user: User
  menus: MenuNode[]
  product: string
  display_name: string
  labels: Labels
  idle_timeout_minutes?: number
}

export type Patient = {
  id: string
  party_id: string
  patient_no: string
  first_name: string
  middle_name?: string | null
  last_name?: string | null
  full_name: string
  gender: string
  age?: string | null
  mobile?: string | null
  city?: string | null
  is_active: boolean
}

export type OpdBill = {
  id: string
  bill_no: string
  bill_date: string
  patient_id: string
  patient_no: string
  gross_amount: number
  net_amount: number
  status: string
  lines: Array<{
    id: string
    service_code: string
    service_name: string
    rate: number
    quantity: number
    amount: number
  }>
}
