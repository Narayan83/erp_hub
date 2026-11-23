export type RoleBrief = { id: string; name: string }

export type User = {
  id: string
  username: string
  email: string
  full_name: string
  is_active?: boolean
  roles?: RoleBrief[]
  menus?: string[]
}

export type RoleMenu = {
  menu_key: string
  can_view: boolean
  can_add: boolean
  can_edit: boolean
  can_delete: boolean
}

export type Role = {
  id: string
  name: string
  description: string
  menus: RoleMenu[]
}

export type Company = {
  id?: string
  name_en: string
  name_kn: string
  address_en: string
  address_kn: string
  village: string
  taluk: string
  district: string
  state: string
  pin: string
  phone: string
  mobile: string
  email: string
  website: string
  reg_no: string
  gstin: string
  pan: string
  financial_year: string
  member_count?: number
}

export type Category = {
  id: string
  code: string
  name_en: string
  name_kn: string
  is_default: boolean
}

export type ShareType = {
  id: string
  code: number
  prefix: string
  name: string
  legacy_code: number | null
  is_active: boolean
}

export type Member = {
  id: string
  acno: number
  shac: string
  share_nos: string
  first_en: string
  first_kn: string
  second_en: string
  second_kn: string
  third_en: string
  third_kn: string
  village_en: string
  village_kn: string
  post_en: string
  post_kn: string
  taluk_en: string
  taluk_kn: string
  dist_en: string
  dist_kn: string
  pin: string
  category: string
  sex: string
  mobile: string
  phone: string
  closed: boolean
  share_type_code: number
  has_photo?: boolean
  has_sign?: boolean
  name_kn: string
  name_en: string
}

export type MemberList = {
  items: Member[]
  total: number
  page: number
  page_size: number
  next_acno: number
}

export type LabelItem = {
  acno: number
  acno_display: string
  share_no: string
  name_kn: string
  name_en: string
  village_kn: string
  village_en: string
  post_kn: string
  post_en: string
  taluk_kn: string
  taluk_en: string
  dist_kn: string
  dist_en: string
  pin: string
}

export type Txn = {
  id: string
  acno: number
  typ: number | null
  astyp: string
  txn_date: string | null
  rno: string
  amount: number
  drcr: number | null
  kind: string
  kind_label: string
  narration: string
  board_meeting: string
  share_count: number
  running_balance?: number
}

export type Ledger = {
  member: Member
  items: Txn[]
  addition_amount: number
  deletion_amount: number
  balance: number
  share_nos: string
  next_rno: string
}

export type ScheduleRow = {
  acno: number
  name_en: string
  name_kn: string
  mobile: string
  category: string
  share_nos: string
  addition_amount: number
  deletion_amount: number
  balance: number
}

export type SummaryRow = {
  acno: number
  name_en: string
  name_kn: string
  balance: number
  share_nos: string
  share_no: string
  village_en: string
  village_kn: string
  post_en: string
  post_kn: string
  taluk_en: string
  taluk_kn: string
  district_en: string
  district_kn: string
  category: string
  sex: string
  mobile: string
  phone: string
  share_type_code: number
  share_type_name: string
  share_type_prefix: string
  share_type_label: string
}

export type LoginResponse = {
  access_token: string
  user: User
}

export const emptyMember = (acno = 1): Omit<Member, 'id' | 'name_kn' | 'name_en' | 'share_nos' | 'has_photo' | 'has_sign'> => ({
  acno,
  shac: '',
  first_en: '',
  first_kn: '',
  second_en: '',
  second_kn: '',
  third_en: '',
  third_kn: '',
  village_en: '',
  village_kn: '',
  post_en: '',
  post_kn: '',
  taluk_en: '',
  taluk_kn: '',
  dist_en: '',
  dist_kn: '',
  pin: '',
  category: 'G',
  sex: '',
  mobile: '',
  phone: '',
  closed: false,
  share_type_code: 4,
})
