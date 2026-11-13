import { MasterPage } from '../components/MasterPage'

export function PartnerMasterPage() {
  return (
    <MasterPage
      title="Partner master"
      hint="One partner list for the whole app. Assign multiple partners when creating a project."
      path="/partners"
      empty={{ name: '', phone: '', email: '', address: '', notes: '', is_active: true }}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'address', label: 'Address', type: 'textarea', wide: true },
        { key: 'notes', label: 'Notes', type: 'textarea', wide: true, list: false },
        { key: 'is_active', label: 'Active', type: 'checkbox', list: false },
      ]}
    />
  )
}

export function LocationMasterPage() {
  return (
    <MasterPage
      title="Location master"
      hint="Farm / site locations with address and contact details."
      path="/locations"
      empty={{
        name: '',
        address: '',
        village: '',
        taluk: '',
        district: '',
        state: 'Karnataka',
        pin: '',
        contact_name: '',
        contact_number: '',
        notes: '',
        is_active: true,
      }}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'contact_number', label: 'Contact number' },
        { key: 'contact_name', label: 'Contact name' },
        { key: 'village', label: 'Village' },
        { key: 'taluk', label: 'Taluk' },
        { key: 'district', label: 'District' },
        { key: 'state', label: 'State' },
        { key: 'pin', label: 'PIN' },
        { key: 'address', label: 'Address', type: 'textarea', wide: true },
        { key: 'notes', label: 'Notes', type: 'textarea', wide: true, list: false },
        { key: 'is_active', label: 'Active', type: 'checkbox', list: false },
      ]}
    />
  )
}

export function PhaseMasterPage() {
  return (
    <MasterPage
      title="Phase master"
      hint="Phases such as Phase 6 / Phase 7 used on transactions."
      path="/phases"
      empty={{ code: '', name: '', description: '', start_date: '', end_date: '', is_active: true }}
      fields={[
        { key: 'code', label: 'Code', required: true },
        { key: 'name', label: 'Name', required: true },
        { key: 'start_date', label: 'Start' },
        { key: 'end_date', label: 'End' },
        { key: 'description', label: 'Description', type: 'textarea', wide: true, list: false },
        { key: 'is_active', label: 'Active', type: 'checkbox', list: false },
      ]}
    />
  )
}

export function WorkTypeMasterPage() {
  return (
    <MasterPage
      title="Work type"
      hint="Categories like Labour, Salary, Travel, Seeds, Crop Income."
      path="/work-types"
      empty={{ code: '', name: '', description: '', is_active: true }}
      fields={[
        { key: 'code', label: 'Code', required: true },
        { key: 'name', label: 'Name', required: true },
        { key: 'description', label: 'Description', type: 'textarea', wide: true },
        { key: 'is_active', label: 'Active', type: 'checkbox', list: false },
      ]}
    />
  )
}

export function LabourMasterPage() {
  return (
    <MasterPage
      title="Labour master"
      path="/labours"
      empty={{ name: '', phone: '', address: '', role: '', daily_rate: '', notes: '', is_active: true }}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'phone', label: 'Phone' },
        { key: 'role', label: 'Role' },
        { key: 'daily_rate', label: 'Daily rate' },
        { key: 'address', label: 'Address', type: 'textarea', wide: true },
        { key: 'notes', label: 'Notes', type: 'textarea', wide: true, list: false },
        { key: 'is_active', label: 'Active', type: 'checkbox', list: false },
      ]}
    />
  )
}

export function VendorMasterPage() {
  return (
    <MasterPage
      title="Vendor master"
      path="/vendors"
      empty={{ name: '', phone: '', email: '', address: '', gstin: '', notes: '', is_active: true }}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'gstin', label: 'GSTIN' },
        { key: 'address', label: 'Address', type: 'textarea', wide: true },
        { key: 'notes', label: 'Notes', type: 'textarea', wide: true, list: false },
        { key: 'is_active', label: 'Active', type: 'checkbox', list: false },
      ]}
    />
  )
}

export function LedgerMasterPage() {
  return (
    <MasterPage
      title="Ledger master"
      hint="Farm ledgers (Cash, Partner Capital, Labour Expense, etc.). Balance shows on list."
      path="/ledgers"
      empty={{
        code: '',
        name: '',
        group_name: '',
        ledger_type: 'EXPENSE',
        opening_balance: '0',
        notes: '',
        is_active: true,
      }}
      fields={[
        { key: 'code', label: 'Code', required: true },
        { key: 'name', label: 'Name', required: true },
        { key: 'group_name', label: 'Group' },
        {
          key: 'ledger_type',
          label: 'Type',
          type: 'select',
          options: [
            { value: 'ASSET', label: 'Asset' },
            { value: 'LIABILITY', label: 'Liability' },
            { value: 'INCOME', label: 'Income' },
            { value: 'EXPENSE', label: 'Expense' },
          ],
        },
        { key: 'opening_balance', label: 'Opening balance' },
        { key: 'balance', label: 'Balance', form: false },
        { key: 'notes', label: 'Notes', type: 'textarea', wide: true, list: false },
        { key: 'is_active', label: 'Active', type: 'checkbox', list: false },
      ]}
    />
  )
}

export function PaymentModeMasterPage() {
  return (
    <MasterPage
      title="Payment modes"
      hint="Each mode is Credit (receipt) or Debit (payment). Transactions inherit this automatically."
      path="/payment-modes"
      empty={{ code: '', name: '', entry_type: 'debit', notes: '', is_active: true }}
      fields={[
        { key: 'code', label: 'Code', required: true },
        { key: 'name', label: 'Name', required: true },
        {
          key: 'entry_type',
          label: 'Credit / Debit',
          type: 'select',
          options: [
            { value: 'credit', label: 'Credit (Receipt)' },
            { value: 'debit', label: 'Debit (Payment)' },
          ],
        },
        { key: 'notes', label: 'Notes', type: 'textarea', wide: true, list: false },
        { key: 'is_active', label: 'Active', type: 'checkbox', list: false },
      ]}
    />
  )
}
