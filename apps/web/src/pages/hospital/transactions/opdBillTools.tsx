import { FormEvent, useState } from 'react'
import { api } from '../../../api/client'
import '../billing/hms-master.css'
import { errMsg, fmtMoney } from '../shared/hmsShared'

export type OpdPayment = { payment_mode_id: string; payment_mode_name?: string | null; amount: number | string; document_no?: string | null }
export type OpdLine = {
  service_id: string | null
  service_name: string
  rate: number | string
  quantity: number
  amount: number | string
  original_rate?: number | string | null
  hospital_amount?: number | string
  doctor_amount?: number | string
  sharing_doctor_id?: string | null
  line_source?: string
  package_id?: string | null
}
export type OpdBillFull = {
  id: string
  bill_no: string
  bill_date: string
  patient_id: string
  patient_no?: string | null
  patient_name?: string | null
  doctor_id: string | null
  doctor_name?: string | null
  department_id?: string | null
  department_name?: string | null
  payment_mode_id?: string | null
  payment_mode_name?: string | null
  payments?: OpdPayment[]
  scheme?: string | null
  admin_charges?: number | string
  scheme_discount?: number | string
  sanctioned_scheme_amount?: number | string
  adjust_advance?: number | string
  gross_amount: number | string
  net_amount: number | string
  remarks?: string | null
  visit_category?: string
  token_session?: string | null
  appointment_date?: string | null
  status?: string
  lines: OpdLine[]
}

/** Rebuild a full OpdBillUpdate payload from a loaded bill, applying `over`. */
export function opdUpdatePayload(bill: OpdBillFull, over: Record<string, unknown> = {}) {
  return {
    doctor_id: bill.doctor_id,
    payment_mode_id: bill.payment_mode_id || null,
    payments: (bill.payments || []).map((p) => ({
      payment_mode_id: p.payment_mode_id,
      amount: Number(p.amount),
      document_no: p.document_no || null,
    })),
    department_id: bill.department_id || null,
    scheme: bill.scheme || null,
    admin_charges: Number(bill.admin_charges || 0),
    scheme_discount: Number(bill.scheme_discount || 0),
    sanctioned_scheme_amount: Number(bill.sanctioned_scheme_amount || 0),
    adjust_advance: Number(bill.adjust_advance || 0),
    remarks: bill.remarks || null,
    bill_date: bill.bill_date,
    visit_category: bill.visit_category || 'opd',
    token_session: bill.token_session || 'morning',
    appointment_date: bill.appointment_date || null,
    lines: bill.lines.map((l) => ({
      service_id: l.service_id,
      quantity: l.quantity,
      rate: Number(l.rate),
      service_name: l.service_name,
      line_source: l.line_source || 'manual',
      package_id: l.package_id || null,
      original_rate: l.original_rate == null ? null : Number(l.original_rate),
      hospital_amount: l.hospital_amount == null ? null : Number(l.hospital_amount),
      doctor_amount: l.doctor_amount == null ? null : Number(l.doctor_amount),
      sharing_doctor_id: l.sharing_doctor_id || null,
    })),
    ...over,
  }
}

/** Bill-number lookup (OPD) with a compact bill summary. */
export function OpdBillLookup({
  bill,
  onLoaded,
  onError,
}: {
  bill: OpdBillFull | null
  onLoaded: (b: OpdBillFull | null) => void
  onError: (msg: string | null) => void
}) {
  const [billNo, setBillNo] = useState('')
  const [busy, setBusy] = useState(false)

  async function find(e: FormEvent) {
    e.preventDefault()
    if (!billNo.trim()) return
    setBusy(true)
    onError(null)
    onLoaded(null)
    try {
      onLoaded(await api.get<OpdBillFull>(`/hospital/opd-bills/by-no/${encodeURIComponent(billNo.trim())}`))
    } catch (err) {
      onError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hms-box">
      <div className="hms-box-title">OPD Bill</div>
      <form className="hms-toolbar" onSubmit={find}>
        <label>Bill No</label>
        <input className="hms-field" style={{ width: 200 }} value={billNo} onChange={(e) => setBillNo(e.target.value)} />
        <button className="hms-btn hms-btn-primary" type="submit" disabled={busy}>
          {busy ? '…' : 'Load'}
        </button>
      </form>
      {bill && (
        <div>
          <strong>{bill.bill_no}</strong> · {bill.bill_date} · {bill.patient_no} — {bill.patient_name} · Dr.{' '}
          {bill.doctor_name || '—'} · Gross {fmtMoney(bill.gross_amount)} · Net {fmtMoney(bill.net_amount)}
          {bill.status ? ` · ${bill.status}` : ''}
        </div>
      )}
    </div>
  )
}
