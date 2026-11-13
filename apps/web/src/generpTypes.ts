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
  user_type_sort_order?: number
}

export type LoginResponse = {
  access_token: string
  token_type: string
  user: User
  menus: MenuNode[]
  app_data?: Record<string, unknown>
  idle_timeout_minutes?: number
}

export type ProductImage = {
  id: string
  product_id: string
  file_path: string
  image_url: string
  is_primary: boolean
  sort_order: number
}

export type Product = {
  id: string
  code?: string | null
  barcode?: string | null
  name?: string | null
  category_id?: string | null
  sub_category_id?: string | null
  gst_id?: string | null
  tax_slabs?: TaxSlab[] | null
  unit?: string | null
  hsn_code?: string | null
  item_type?: 'goods' | 'service' | string | null
  purchase_price?: number | string | null
  sale_price?: number | string | null
  wholesale_price?: number | string | null
  mrp?: number | string | null
  max_discount_pct?: number | string | null
  moq?: number | string | null
  opening_stock?: number | string | null
  current_stock?: number | string | null
  is_active?: boolean
    is_in_shop?: boolean
    own_barcode?: boolean
    category_name?: string | null
    sub_category_name?: string | null
    gst_name?: string | null
    gst_rate?: number | string | null
    image_path?: string | null
    image_url?: string | null
    parent_id?: string | null
    images?: ProductImage[]
  }

  export type ProductImportResult = {
    created: number
    skipped: number
    errors: string[]
    message: string
  }

export type ProductBarcode = {
  id: string
  product_id: string
  barcode: string
  sale_rate?: number | null
  ws_rate?: number | null
  mrp?: number | null
  kind?: 'own' | 'company' | string
  is_active: boolean
}

export type Category = {
  id: string
  code?: string
  name: string
}

export type SubCategory = {
  id: string
  category_id: string
  code?: string
  name: string
}

export type Party = {
  id: string
  code?: string | null
  name: string
  party_type?: string
  contact_person?: string | null
  address_line1?: string | null
  address_line2?: string | null
  address_line3?: string | null
  address_line4?: string | null
  city?: string | null
  state?: string | null
  pin_code?: string | null
  shipping_address_line1?: string | null
  shipping_address_line2?: string | null
  shipping_address_line3?: string | null
  shipping_address_line4?: string | null
  shipping_city?: string | null
  shipping_state?: string | null
  shipping_pin_code?: string | null
  same_as_billing?: boolean
  phone?: string | null
  email?: string | null
  gstin?: string | null
  image_path?: string | null
  image_url?: string | null
  opening_balance?: number | string
  opening_type?: string
  ledger_id?: string | null
  is_active?: boolean
}

export type Ledger = {
  id: string
  code: string
  name: string
  group_name?: string
  ledger_type?: string
  opening_balance?: number | string
  opening_type?: string
  is_cash?: boolean
  is_bank?: boolean
  is_party_deposit?: boolean
  sort_order?: number
  is_active?: boolean
}

export type AccountingVoucher = {
  id: string
  voucher_no: string
  voucher_date: string
  source_type: string
  source_id: string
  party_id?: string | null
  party_code?: string | null
  narration?: string | null
  kind?: string | null
  is_active?: boolean
}

export type JournalVoucherLine = {
  id: string
  ledger_id: string
  ledger_code: string
  ledger_name: string
  debit_amount: number | string
  credit_amount: number | string
  narration?: string | null
  sort_order?: number
}

export type JournalVoucher = AccountingVoucher & {
  kind: string
  party_name?: string | null
  is_active: boolean
  total_debit: number | string
  total_credit: number | string
  lines: JournalVoucherLine[]
}

export type JournalVoucherListItem = {
  id: string
  voucher_no: string
  voucher_date: string
  source_type: string
  kind: string
  party_id?: string | null
  party_code?: string | null
  party_name?: string | null
  narration?: string | null
  is_active: boolean
  line_count: number
  total_debit: number | string
  total_credit: number | string
  accounts: string
}

export type LedgerBalance = {
  ledger_id: string
  balance: number | string
  side: string
}

export type PartyDepositBalance = {
  party_id: string
  party_code: string
  party_name?: string | null
  balance: number | string
}

export type CashbookEntry = {
  id: string
  voucher_id: string
  voucher_no: string
  voucher_date: string
  source_type: string
  source_id: string
  ledger_id: string
  ledger_code: string
  ledger_name: string
  party_id?: string | null
  party_code?: string | null
  party_name?: string | null
  narration?: string | null
  line_narration?: string | null
  debit_amount: number | string
  credit_amount: number | string
  running_balance?: number | string | null
}

export type CashbookLedgerStatement = {
  ledger_id: string
  ledger_code: string
  ledger_name: string
  from_date?: string | null
  to_date?: string | null
  opening_balance: number | string
  total_debit: number | string
  total_credit: number | string
  closing_balance: number | string
  entries: CashbookEntry[]
}

export type CashbookDaybook = {
  from_date?: string | null
  to_date?: string | null
  total_debit: number | string
  total_credit: number | string
  entries: CashbookEntry[]
}

export type CashbookPartyAccount = {
  party_id: string
  party_code: string
  party_name?: string | null
  total_debit: number | string
  total_credit: number | string
  balance: number | string
  deposit_balance?: number | string | null
  entries: CashbookEntry[]
}

export type GstRate = {
  id: string
  code?: string | null
  name?: string | null
  rate?: number | string | null
  cgst?: number | string | null
  sgst?: number | string | null
  igst?: number | string | null
  sort_order?: number
  is_active?: boolean
}

export type TaxSlab = {
  min_amount: number
  rate: number
  gst_id?: string | null
}

export type TaxMode = 'inclusive' | 'exclusive'

export type CompanyProfile = {
  id?: string
  code?: string
  name: string
  address_line1?: string | null
  address_line2?: string | null
  address_line3?: string | null
  address_line4?: string | null
  city?: string | null
  state?: string | null
  pin_code?: string | null
  phone?: string | null
  mobile?: string | null
  email?: string | null
  website?: string | null
  gstin?: string | null
  software_id?: string | null
  sale_tax_mode?: TaxMode | string
  wholesale_tax_mode?: TaxMode | string
  purchase_tax_mode?: TaxMode | string
  sale_rate_source?: 'product_master' | 'fifo' | string
  allow_negative_stock?: boolean
  purchase_bill_parking?: boolean
  logo_path?: string | null
  logo_url?: string | null
}

export type PaymentMode = {
  id: string
  code?: string | number | null
  name: string
  is_cash?: boolean
  is_credit?: boolean
}

export type SaleEntryConfig = {
  enable_qty: boolean
  enable_rate: boolean
  enable_discount: boolean
  default_qty: number
}

export type BillLine = {
  product_id: string
  code?: string | null
  name?: string | null
  qty: number
  rate: number
  mrp?: number
  sale_price?: number
  profit_pct?: number
  max_discount_pct?: number
  disc_pct: number
  gst_id?: string | null
  gst_rate: number
  tax_slabs?: TaxSlab[] | null
  stock?: number
}

export type VoucherItem = {
  product_id: string
  product_name?: string | null
  product_code?: string | null
  quantity: number | string
  rate: number | string
  discount_amount: number | string
  gst_id?: string | null
  gst_rate?: number | string | null
  mrp?: number | string | null
  sale_price?: number | string | null
  profit_pct?: number | string | null
  max_discount_pct?: number | string | null
}

export type VoucherPayment = {
  payment_mode_id: string
  amount: number | string
  reference?: string | null
}

export type Voucher = {
  id: string
  voucher_no?: string | null
  voucher_date?: string | null
  party_id?: string | null
  party_name?: string | null
  party_bill_no?: string | null
  narration?: string | null
  adjust_advance?: number | string | null
  net_amount?: number | string | null
  is_cancelled?: boolean
  is_parked?: boolean
  items?: VoucherItem[]
  payments?: VoucherPayment[]
}

export type Branch = {
  id: string
  code: string
  name: string
  address?: string | null
  is_main?: boolean
  is_active?: boolean
}

export type StockVoucherItem = {
  id?: string
  product_id: string
  product_code?: string | null
  product_name?: string | null
  line_role: string
  quantity: number | string
  unit?: string | null
  rate?: number | string
  amount?: number | string
  narration?: string | null
}

export type StockVoucher = {
  id: string
  voucher_type: string
  voucher_no: string
  voucher_date: string
  branch_id?: string | null
  branch_name?: string | null
  counterparty_branch_id?: string | null
  counterparty_branch_name?: string | null
  party_id?: string | null
  reference_no?: string | null
  narration?: string | null
  wastage_qty?: number | string
  is_cancelled?: boolean
  items?: StockVoucherItem[]
}

export type StockVoucherListItem = {
  id: string
  voucher_type: string
  voucher_no: string
  voucher_date: string
  narration?: string | null
  is_cancelled?: boolean
  item_count?: number
}

export type StockLedgerRow = {
  id: string
  movement_date: string
  product_id: string
  product_code?: string | null
  product_name?: string | null
  qty_delta: number | string
  movement_type: string
  ref_no?: string | null
  narration?: string | null
  running_balance?: number | string | null
}

export type StockBalance = {
  product_id: string
  product_code?: string | null
  product_name?: string | null
  current_stock: number | string
  unit?: string | null
}

export type DiscountScheme = {
  id: string
  code: string
  name: string
  scope: string
  discount_type: string
  value: number | string
  min_bill_amount?: number | string
  max_discount_amount?: number | string | null
  product_id?: string | null
  category_id?: string | null
  valid_from?: string | null
  valid_to?: string | null
  applies_to?: string
  narration?: string | null
  is_active?: boolean
}

export type OrderItem = {
  id?: string
  product_id: string
  product_code?: string | null
  product_name?: string | null
  quantity: number | string
  qty_fulfilled?: number | string
  rate: number | string
  discount_amount?: number | string
  gst_id?: string | null
  gst_rate?: number | string
  amount?: number | string
}

export type Order = {
  id: string
  order_type: string
  order_no: string
  order_date: string
  party_id?: string | null
  party_name?: string | null
  status: string
  narration?: string | null
  discount_scheme_id?: string | null
  discount_amount?: number | string
  gross_amount?: number | string
  tax_amount?: number | string
  net_amount?: number | string
  is_cancelled?: boolean
  converted_voucher_id?: string | null
  items?: OrderItem[]
}

export type OrderListItem = {
  id: string
  order_type: string
  order_no: string
  order_date: string
  party_name?: string | null
  status: string
  net_amount: number | string
  is_cancelled?: boolean
}

export type PurchaseImportLine = {
  product_id: string
  code?: string | null
  name?: string | null
  qty: number
  rate: number
  mrp?: number
  sale_price?: number
  profit_pct?: number
  disc_pct: number
  gst_rate: number
  gst_id?: string | null
}

export type PurchaseImportPreview = {
  lines: PurchaseImportLine[]
  errors: string[]
  imported: number
  skipped: number
  message: string
}

export type PartyScheduleRow = {
  party_id?: string | null
  ledger_id: string
  name: string
  debit: number
  credit: number
  balance: number
}

export type PartyLedgerDetails = {
  ledger_id: string
  ledger_name: string
  opening_balance: number
  closing_balance: number
  rows: Array<{
    entry_date: string
    voucher_type: string
    voucher_no: string
    narration?: string | null
    debit: number
    credit: number
    balance: number
  }>
}
