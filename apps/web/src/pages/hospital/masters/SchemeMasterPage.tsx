import '../billing/hms-master.css'
import { ApiPendingNotice } from '../shared/hmsKit'

/**
 * Scheme Master (legacy CMASTER/SC). The HMS API (modules/hospital/hms/api/v1/router.py) has no
 * `/schemes` prefix — `scheme` is a free-text column on patients and OPD/IPD bills — so there is
 * nothing to persist here yet.
 */
export function SchemeMasterPage() {
  return (
    <div className="hms-page">
      <h1>Scheme Master</h1>
      <div className="hint">Create / Modify / Delete insurance &amp; welfare schemes.</div>
      <ApiPendingNotice>
        There is no scheme endpoint on the hospital API yet. Until one is mounted, the scheme is
        entered as free text on the Patient Master and on OPD / IPD bills. Once a{' '}
        <code>/hospital/schemes</code> router exists, replace this page with an{' '}
        <code>ActionSelectMaster</code> (code + name).
      </ApiPendingNotice>
    </div>
  )
}
