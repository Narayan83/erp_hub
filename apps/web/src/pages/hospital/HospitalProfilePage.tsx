import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { ClearDatabaseDialog } from './ClearDatabaseDialog'
import './billing/hms-master.css'

type Profile = {
  id?: string
  code?: string
  name: string
  pathology_name?: string | null
  medical_shop_name?: string | null
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
  pathology_gstin?: string | null
  medical_shop_gstin?: string | null
  hospital_registration_number?: string | null
  software_id?: string | null
}

type BackupSettings = {
  enabled: boolean
  backup_time: string
  directory: string | null
  keep_days: number
  last_backup_at: string | null
  last_backup_status: string | null
  last_backup_file: string | null
  scheduler_note: string
}

const EMPTY: Profile = {
  name: '',
  pathology_name: '',
  medical_shop_name: '',
  address_line1: '',
  address_line2: '',
  address_line3: '',
  address_line4: '',
  city: '',
  state: '',
  pin_code: '',
  phone: '',
  mobile: '',
  email: '',
  website: '',
  gstin: '',
  pathology_gstin: '',
  medical_shop_gstin: '',
  hospital_registration_number: '',
  software_id: '',
}

const EMPTY_BACKUP: BackupSettings = {
  enabled: false,
  backup_time: '22:00',
  directory: '',
  keep_days: 30,
  last_backup_at: null,
  last_backup_status: null,
  last_backup_file: null,
  scheduler_note: '',
}

const FIELDS: Array<{
  key: keyof Profile
  label: string
  placeholder?: string
  required?: boolean
  maxLength?: number
}> = [
  {
    key: 'name',
    label: 'Company / Hospital Name *',
    placeholder: 'Company / hospital name shown on report headings',
    required: true,
  },
  {
    key: 'pathology_name',
    label: 'Pathology Name',
    placeholder: 'Name shown at top of pathology bills/reports',
  },
  {
    key: 'medical_shop_name',
    label: 'Medical Shop Name',
    placeholder: 'Name shown at top of medical shop bills',
  },
  { key: 'address_line1', label: 'Address 1', placeholder: 'Address line 1' },
  { key: 'address_line2', label: 'Address 2', placeholder: 'Address line 2' },
  { key: 'address_line3', label: 'Address 3', placeholder: 'Address line 3' },
  { key: 'address_line4', label: 'Address 4', placeholder: 'Address line 4' },
  { key: 'city', label: 'City', placeholder: 'City' },
  { key: 'state', label: 'State', placeholder: 'State' },
  { key: 'pin_code', label: 'PIN' },
  { key: 'phone', label: 'Phone' },
  { key: 'mobile', label: 'Mobile', placeholder: 'Mobile', maxLength: 100 },
  { key: 'email', label: 'Email' },
  { key: 'website', label: 'Website', placeholder: 'Website' },
  {
    key: 'hospital_registration_number',
    label: 'Hospital Registration No',
    placeholder: 'Hospital registration number',
  },
  { key: 'gstin', label: 'Hospital GSTIN', placeholder: 'Hospital GSTIN' },
  { key: 'pathology_gstin', label: 'Lab GSTIN', placeholder: 'Lab / Pathology GSTIN' },
  { key: 'medical_shop_gstin', label: 'Medical GSTIN', placeholder: 'Medical shop GSTIN' },
  { key: 'software_id', label: 'Software ID', placeholder: 'Software ID (enter manually)' },
]

function formatBackupStamp(value: string | null | undefined): string {
  let text = String(value || '').trim()
  if (!text) return ''
  text = text.replace('T', ' ')
  if (text.includes('.')) text = text.split('.', 1)[0]
  if (text.includes('+')) text = text.split('+', 1)[0].trim()
  return text
}

function backupStatusLines(data: BackupSettings): string {
  const lines: string[] = []
  const stamp = formatBackupStamp(data.last_backup_at)
  if (stamp) lines.push(`Last attempt: ${stamp}`)
  if (data.last_backup_status === 'ok') lines.push('Last backup succeeded.')
  else if (data.last_backup_status) lines.push(data.last_backup_status)
  if (data.last_backup_file) lines.push(data.last_backup_file)
  return lines.length ? lines.join('\n') : 'No backup has run yet.'
}

export function HospitalProfilePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isAdmin = Boolean(user?.roles?.includes('Super Admin'))

  const [form, setForm] = useState<Profile>({ ...EMPTY })
  const [backup, setBackup] = useState<BackupSettings>({ ...EMPTY_BACKUP })
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [showReset, setShowReset] = useState(false)

  const loadBackup = useCallback(async () => {
    if (!isAdmin) return
    try {
      const data = await api.get<BackupSettings>('/hospital/backup')
      setBackup({
        ...EMPTY_BACKUP,
        ...data,
        directory: data.directory || '',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [isAdmin])

  const refresh = useCallback(async () => {
    setError(null)
    setOk(null)
    try {
      const data = await api.get<Profile>('/hospital/hospital-profile')
      setForm({ ...EMPTY, ...data })
      await loadBackup()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [loadBackup])

  useEffect(() => {
    void refresh()
  }, [refresh])

  function setField(key: keyof Profile, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) {
      setError('Company / hospital name is required.')
      return
    }
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const payload = {
        name,
        pathology_name: form.pathology_name?.trim() || null,
        medical_shop_name: form.medical_shop_name?.trim() || null,
        address_line1: form.address_line1?.trim() || null,
        address_line2: form.address_line2?.trim() || null,
        address_line3: form.address_line3?.trim() || null,
        address_line4: form.address_line4?.trim() || null,
        city: form.city?.trim() || null,
        state: form.state?.trim() || null,
        pin_code: form.pin_code?.trim() || null,
        phone: form.phone?.trim() || null,
        mobile: form.mobile?.trim() || null,
        email: form.email?.trim() || null,
        website: form.website?.trim() || null,
        gstin: form.gstin?.trim() || null,
        pathology_gstin: form.pathology_gstin?.trim() || null,
        medical_shop_gstin: form.medical_shop_gstin?.trim() || null,
        hospital_registration_number: form.hospital_registration_number?.trim() || null,
        software_id: form.software_id?.trim() || null,
      }
      const saved = await api.put<Profile>('/hospital/hospital-profile', payload)
      setForm({ ...EMPTY, ...saved })
      setOk('Settings saved. Report headings will use the updated company name and address.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function saveBackup() {
    if (backup.enabled && !String(backup.directory || '').trim()) {
      setError('Choose a folder on the server PC.')
      return
    }
    setBackupBusy(true)
    setError(null)
    setOk(null)
    try {
      const data = await api.put<BackupSettings>('/hospital/backup', {
        enabled: backup.enabled,
        backup_time: backup.backup_time || '22:00',
        directory: String(backup.directory || '').trim() || null,
        keep_days: Number(backup.keep_days) || 30,
      })
      setBackup({ ...EMPTY_BACKUP, ...data, directory: data.directory || '' })
      setOk('Backup settings saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBackupBusy(false)
    }
  }

  async function runBackupNow() {
    setBackupBusy(true)
    setError(null)
    setOk(null)
    try {
      const data = await api.post<BackupSettings>('/hospital/backup/run')
      setBackup({ ...EMPTY_BACKUP, ...data, directory: data.directory || '' })
      if (data.last_backup_status !== 'ok') {
        setError(data.last_backup_status || 'Backup failed.')
      } else {
        setOk(`Database dump saved.\n${data.last_backup_file || ''}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      await loadBackup()
    } finally {
      setBackupBusy(false)
    }
  }

  return (
    <div className="hms-page">
      <h1>Settings</h1>
      <div className="hint">
        Basic hospital configuration. The company name and address appear as the report heading on
        printouts. Pathology and medical shop bills can use their own names while keeping the same
        address/contact details.
      </div>
      {error && <div className="hms-error" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}
      {ok && <div className="hms-ok" style={{ whiteSpace: 'pre-wrap' }}>{ok}</div>}

      <form className="hms-box" onSubmit={onSubmit}>
        <div className="hms-box-title">Hospital / Company Details</div>
        <div className="hms-form-rows" style={{ marginTop: 4 }}>
          {FIELDS.map(({ key, label, placeholder, required, maxLength }) => (
            <div className="hms-form-row" key={key}>
              <label htmlFor={`hp-${key}`}>{label}</label>
              <input
                id={`hp-${key}`}
                className="hms-field"
                required={required}
                maxLength={maxLength}
                placeholder={placeholder}
                value={String(form[key] ?? '')}
                onChange={(e) => setField(key, e.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="hms-actions">
          <button className="hms-btn hms-btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="hms-btn" type="button" onClick={() => void refresh()} disabled={busy}>
            Reload
          </button>
        </div>
      </form>

      {isAdmin && (
        <>
          <div className="hms-box hms-box-backup">
            <div className="hms-box-title">Automatic Database Backup</div>
            <div className="hint" style={{ marginTop: 4 }}>
              Saves a PostgreSQL dump on the server PC (the machine running the API), not on a client
              PC. Pick a full folder path such as D:\HMS-Backups. One successful dump is kept per day.
              Older dump files in that folder are deleted after the keep period.
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={backup.enabled}
                onChange={(e) => setBackup((b) => ({ ...b, enabled: e.target.checked }))}
              />
              Enable daily automatic backup
            </label>
            <div className="hms-form-rows">
              <div className="hms-form-row">
                <label htmlFor="backup-time">Time</label>
                <input
                  id="backup-time"
                  className="hms-field"
                  type="time"
                  value={backup.backup_time || '22:00'}
                  onChange={(e) => setBackup((b) => ({ ...b, backup_time: e.target.value }))}
                />
              </div>
              <div className="hms-form-row">
                <label htmlFor="backup-dir">Folder on the server PC</label>
                <input
                  id="backup-dir"
                  className="hms-field"
                  placeholder="D:\HMS-Backups"
                  value={backup.directory || ''}
                  onChange={(e) => setBackup((b) => ({ ...b, directory: e.target.value }))}
                />
              </div>
              <div className="hms-form-row">
                <label htmlFor="backup-keep">Keep dumps</label>
                <input
                  id="backup-keep"
                  className="hms-field"
                  type="number"
                  min={1}
                  max={365}
                  value={backup.keep_days}
                  onChange={(e) =>
                    setBackup((b) => ({ ...b, keep_days: Number(e.target.value) || 30 }))
                  }
                />
              </div>
            </div>
            <div className="hint" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>
              {backupStatusLines(backup)}
            </div>
            {backup.scheduler_note ? (
              <div className="hint">{backup.scheduler_note}</div>
            ) : null}
            <div className="hms-actions">
              <button
                className="hms-btn hms-btn-primary"
                type="button"
                disabled={backupBusy}
                onClick={() => void saveBackup()}
              >
                {backupBusy ? 'Working…' : 'Save backup settings'}
              </button>
              <button
                className="hms-btn"
                type="button"
                disabled={backupBusy}
                onClick={() => void runBackupNow()}
              >
                Backup now
              </button>
            </div>
          </div>

          <div className="hms-box hms-box-danger">
            <div className="hms-box-title">Database Maintenance</div>
            <div className="hint" style={{ marginTop: 4 }}>
              Reset transactional data, or copy an old database into this version. Hospital
              information, users and menus are always kept on reset. Both tools require the
              maintenance password.
            </div>
            <div className="hms-actions">
              <button
                className="hms-btn hms-btn-danger"
                type="button"
                onClick={() => setShowReset(true)}
              >
                Reset Database…
              </button>
              <button
                className="hms-btn hms-btn-navy"
                type="button"
                onClick={() => navigate('/database_migration')}
              >
                Database Migration…
              </button>
            </div>
          </div>
        </>
      )}

      <ClearDatabaseDialog open={showReset} onClose={() => setShowReset(false)} />
    </div>
  )
}
