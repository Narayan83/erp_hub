import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Ledger } from '../types'
import { LedgerTable } from './LedgerTable'
import { MemberSnapshot } from './MemberSnapshot'

export function LedgerModal({ acno, onClose }: { acno: number; onClose: () => void }) {
  const [data, setData] = useState<Ledger | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<Ledger>(`/ledger/${acno}`)
      .then(setData)
      .catch((err: Error) => setError(err.message))
  }, [acno])

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal ledger-modal" onClick={(e) => e.stopPropagation()}>
        <div className="snap-head no-print">
          <h2>Ledger · ACNO {acno}</h2>
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {data && (
          <>
            <MemberSnapshot member={data.member} />
            <LedgerTable ledger={data} />
          </>
        )}
      </div>
    </div>
  )
}
