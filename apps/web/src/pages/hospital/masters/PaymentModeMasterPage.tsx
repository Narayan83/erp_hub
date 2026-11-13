import { ActionSelectMaster } from './ActionSelectMaster'

export function PaymentModeMasterPage() {
  return (
    <ActionSelectMaster
      title="Payment Mode Creation"
      listPath="/hospital/payment-modes"
      codeKey="code"
      labelKey="name"
      defaults={{ code: '', name: '', sort_order: 0, is_cash: true }}
      fields={[
        { key: 'code', label: 'Code', required: true },
        { key: 'name', label: 'Name', required: true },
        { key: 'sort_order', label: 'Sort Order', type: 'number' },
        { key: 'is_cash', label: 'Is Cash', type: 'checkbox' },
      ]}
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'is_cash', label: 'Cash' },
        { key: 'sort_order', label: 'Sort' },
      ]}
      mapCreate={(form) => ({
        code: form.code || null,
        name: form.name,
        sort_order: Number(form.sort_order) || 0,
        is_cash: Boolean(form.is_cash),
      })}
      mapUpdate={(form) => ({
        name: form.name,
        sort_order: Number(form.sort_order) || 0,
        is_cash: Boolean(form.is_cash),
      })}
    />
  )
}
