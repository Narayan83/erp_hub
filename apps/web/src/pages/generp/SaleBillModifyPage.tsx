import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { BillFinder, type BillFinderRow } from '../../components/generp/BillFinder'
import { PrintPreview } from '../../components/generp/PrintPreview'
import { loadBillFormat, normalizeBillFormat, readLocalBillFormat, saveBillFormat } from '../../lib/generp/billFormat'
import type { Voucher } from '../../generpTypes'
import {
  SALE_BILL_MODE,
  SaleBillPage,
  type SaleBillMode,
  WHOLESALE_BILL_MODE,
} from './SaleBillPage'

type Props = { mode?: SaleBillMode; reprintOnly?: boolean }

export function SaleBillModifyPage({ mode = SALE_BILL_MODE, reprintOnly = false }: Props) {
  const [searchParams] = useSearchParams()
  const reportCode = mode.voucherType === 'WHOLESALE' ? 'WHOLESALE_BILL' : 'SALE_BILL'
  const [editId, setEditId] = useState<string | null>(null)
  const [loadedNo, setLoadedNo] = useState('')
  const [preview, setPreview] = useState<{
    title: string
    html: string
    voucherId?: string
  } | null>(null)
  const [billFormat, setBillFormat] = useState(() => readLocalBillFormat(reportCode))
  const loadRef = useRef<((v: Voucher) => void) | null>(null)
  const printRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const qid = searchParams.get('voucher_id')
    if (qid) void loadVoucherId(qid)
    void loadBillFormat(reportCode).then(setBillFormat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.voucherType])

  const loadVoucherId = async (voucherId: string, voucherNo?: string | null) => {
    try {
      const voucher = await api.get<Voucher>(`/vouchers/${voucherId}`)
      if (voucherNo) setLoadedNo(voucherNo)
      else if (voucher.voucher_no) setLoadedNo(String(voucher.voucher_no))
      loadRef.current?.(voucher)
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to load bill')
    }
  }

  const openPreview = async (voucherId: string, voucherNo?: string | null) => {
    try {
      const format = billFormat
      const html = await api.getReportHtml(`/reports/sale-bill/${voucherId}`, { format })
      setPreview({
        title: `${mode.heading} ${voucherNo || ''} Preview`.trim(),
        html,
        voucherId,
      })
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Preview failed')
    }
  }

  const changePreviewFormat = async (format: string) => {
    const fmt = normalizeBillFormat(format)
    setBillFormat(fmt)
    void saveBillFormat(reportCode, fmt)
    if (!preview?.voucherId) return
    try {
      const html = await api.getReportHtml(`/reports/sale-bill/${preview.voucherId}`, { format: fmt })
      setPreview((prev) => (prev ? { ...prev, html } : prev))
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to load format')
    }
  }

  const onPick = (row: BillFinderRow) => {
    if (reprintOnly) {
      void openPreview(row.id, row.voucher_no)
      return
    }
    void loadVoucherId(row.id, row.voucher_no)
  }

  return (
    <div className="modify-page">
      <h2>
        {mode.heading} {reprintOnly ? 'Reprint' : 'Modify'}
      </h2>
      <BillFinder
        voucherType={mode.voucherType}
        actionLabel={reprintOnly ? 'Preview' : 'Open'}
        onPick={onPick}
        extraActions={
          reprintOnly
            ? undefined
            : (row) => (
                <button
                  type="button"
                  className="btn"
                  style={{ marginLeft: 6 }}
                  onClick={() => void openPreview(row.id, row.voucher_no)}
                >
                  Preview
                </button>
              )
        }
      />

      {!reprintOnly ? (
        <>
          <div className="sb-row" style={{ marginBottom: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (!editId) alert('Load a bill first.')
                else printRef.current?.()
              }}
            >
              Print loaded bill
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (!editId) alert('Load a bill first.')
                else void openPreview(editId, loadedNo)
              }}
            >
              Preview loaded bill
            </button>
          </div>
          <SaleBillPage
            mode={mode}
            embeddedModify
            onEditIdChange={setEditId}
            loadVoucherRef={loadRef}
            printRef={printRef}
          />
        </>
      ) : null}

      {preview && (
        <PrintPreview
          title={preview.title}
          html={preview.html}
          reportCode={reportCode}
          billFormat={billFormat}
          onBillFormatChange={(fmt) => void changePreviewFormat(fmt)}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}

export function WholesaleBillModifyPage() {
  return <SaleBillModifyPage mode={WHOLESALE_BILL_MODE} />
}

export function SaleBillReprintPage() {
  return <SaleBillModifyPage reprintOnly />
}

export function WholesaleBillReprintPage() {
  return <SaleBillModifyPage mode={WHOLESALE_BILL_MODE} reprintOnly />
}
