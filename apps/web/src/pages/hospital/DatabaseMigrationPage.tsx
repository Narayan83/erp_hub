import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import './billing/hms-master.css'

type FoxMapping = {
  key: string
  label: string
  group: string
  legacy_table: string
  source_filter: string
  default_selected: boolean
  notes?: string
  source_rows?: number | null
  exists?: boolean
}

type PrevTable = {
  key: string
  label: string
  group: string
  group_order: number
  default_selected: boolean
  notes?: string
  source_rows?: number
}

type MdbTable = {
  key: string
  label: string
  mdb_table: string
  group: string
  default_selected: boolean
  notes?: string
  exists?: boolean
  source_rows?: number
  distinct_bills?: number | null
  count_label?: string
}

type TabId = 'foxpro' | 'previous' | 'mdb'

const TOKEN_KEY = 'erp_token'

async function readStream(
  path: string,
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/x-ndjson',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    const detail =
      data && typeof data === 'object' && 'detail' in data ? String(data.detail) : res.statusText
    throw new Error(detail || 'Migration failed')
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No progress stream from the server.')
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      onEvent(JSON.parse(trimmed) as Record<string, unknown>)
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as Record<string, unknown>)
}

function describeEvent(event: Record<string, unknown>): string {
  const type = String(event.type || '')
  const label = String(event.label || event.key || '')
  if (type === 'error') return `Error: ${event.message || 'failed'}`
  if (type === 'complete') return String(event.message || 'Finished.')
  if (type === 'table_done') {
    const ok = event.ok === false ? 'FAILED' : 'ok'
    const imported = event.imported ?? event.source_rows ?? ''
    const error = event.error ? ` — ${event.error}` : ''
    return `${label}: ${ok} ${imported}${error}`.trim()
  }
  if (type === 'rows') {
    return `${label}: ${event.processed ?? 0} / ${event.total ?? event.source_rows ?? '?'}`
  }
  if (event.message) return String(event.message)
  if (label) return `${label}…`
  return type
}

export function DatabaseMigrationPage() {
  const { user } = useAuth()
  const isAdmin = Boolean(user?.roles?.includes('Super Admin'))
  const [tab, setTab] = useState<TabId>('foxpro')
  const [password, setPassword] = useState('')
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [dryRun, setDryRun] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState('')
  const [progress, setProgress] = useState<{ percent: number; message: string } | null>(null)

  const [mysqlUrl, setMysqlUrl] = useState('')
  const [pgUrl, setPgUrl] = useState('')
  const [foxMappings, setFoxMappings] = useState<FoxMapping[]>([])
  const [foxSelected, setFoxSelected] = useState<Record<string, boolean>>({})

  const [sourceUrl, setSourceUrl] = useState('')
  const [prevTables, setPrevTables] = useState<PrevTable[]>([])
  const [prevSelected, setPrevSelected] = useState<Record<string, boolean>>({})

  const [mdbFile, setMdbFile] = useState<File | null>(null)
  const [mdbPath, setMdbPath] = useState('')
  const [mdbPassword, setMdbPassword] = useState('')
  const [mdbFileToken, setMdbFileToken] = useState<string | null>(null)
  const [mdbLoadedName, setMdbLoadedName] = useState<string | null>(null)
  const [mdbServiceCount, setMdbServiceCount] = useState<number | null>(null)
  const [mdbTables, setMdbTables] = useState<MdbTable[]>([])
  const [mdbSelected, setMdbSelected] = useState<Record<string, boolean>>({
    patients: true,
    ipd_bills: true,
  })

  const append = useCallback((line: string) => {
    setLog((prev) => (prev ? `${prev}\n${line}` : line))
  }, [])

  const loadFox = useCallback(async () => {
    const data = await api.get<{
      mysql_connection_string: string
      postgres_connection_string: string
      mappings: FoxMapping[]
    }>('/hospital/admin/legacy-migrate/defaults')
    setMysqlUrl(data.mysql_connection_string)
    setPgUrl(data.postgres_connection_string)
    setFoxMappings(data.mappings)
    const next: Record<string, boolean> = {}
    for (const row of data.mappings) next[row.key] = Boolean(row.default_selected)
    setFoxSelected(next)
  }, [])

  const loadPrevious = useCallback(async (url?: string) => {
    const defaults = await api.get<{ source_url: string; notes?: string }>(
      '/hospital/admin/previous-migrate/defaults',
    )
    const source = url || defaults.source_url
    setSourceUrl(source)
    const preview = await api.post<{ tables: PrevTable[] }>('/hospital/admin/previous-migrate/preview', {
      source_url: source,
    })
    setPrevTables(preview.tables)
    setPrevSelected((current) => {
      const next: Record<string, boolean> = {}
      for (const row of preview.tables) {
        next[row.key] = current[row.key] ?? Boolean(row.default_selected)
      }
      return next
    })
  }, [])

  const loadMdbDefaults = useCallback(async () => {
    const data = await api.get<{ tables: MdbTable[] }>('/hospital/admin/mdb-migrate/defaults')
    setMdbTables(data.tables)
    setMdbSelected((current) => {
      const next: Record<string, boolean> = {}
      for (const row of data.tables) {
        next[row.key] = current[row.key] ?? Boolean(row.default_selected)
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    setError(null)
    void (async () => {
      try {
        await loadFox()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
      try {
        await loadPrevious()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
      try {
        await loadMdbDefaults()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [isAdmin, loadFox, loadPrevious, loadMdbDefaults])

  const foxGroups = useMemo(() => {
    const map = new Map<string, FoxMapping[]>()
    for (const row of foxMappings) {
      const list = map.get(row.group) || []
      list.push(row)
      map.set(row.group, list)
    }
    return [...map.entries()]
  }, [foxMappings])

  const prevGroups = useMemo(() => {
    const map = new Map<string, PrevTable[]>()
    for (const row of [...prevTables].sort((a, b) => a.group_order - b.group_order || a.label.localeCompare(b.label))) {
      const list = map.get(row.group) || []
      list.push(row)
      map.set(row.group, list)
    }
    return [...map.entries()]
  }, [prevTables])

  function patchFox(key: string, patch: Partial<FoxMapping>) {
    setFoxMappings((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  async function testMysql() {
    setBusy(true)
    setError(null)
    try {
      const data = await api.post<{ message: string }>('/hospital/admin/legacy-migrate/test-mysql', {
        mysql_connection_string: mysqlUrl,
      })
      append(data.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function refreshFoxCounts() {
    setBusy(true)
    setError(null)
    try {
      const data = await api.post<{ counts: Array<FoxMapping & { key: string }> }>(
        '/hospital/admin/legacy-migrate/preview',
        {
          mysql_connection_string: mysqlUrl,
          mappings: foxMappings.map((row) => ({
            key: row.key,
            legacy_table: row.legacy_table,
            source_filter: row.source_filter,
          })),
        },
      )
      const byKey = new Map(data.counts.map((row) => [row.key, row]))
      setFoxMappings((rows) =>
        rows.map((row) => {
          const count = byKey.get(row.key)
          return count
            ? { ...row, source_rows: count.source_rows, exists: count.exists, legacy_table: count.legacy_table || row.legacy_table }
            : row
        }),
      )
      append('FoxPro source counts refreshed.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function testPrevious() {
    setBusy(true)
    setError(null)
    try {
      const data = await api.post<{ message: string }>('/hospital/admin/previous-migrate/test', {
        source_url: sourceUrl,
      })
      append(data.message)
      await loadPrevious(sourceUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function inspectMdb(): Promise<string | null> {
    if (!mdbFile && !mdbFileToken && !mdbPath.trim()) {
      fail('Select an .mdb file (or enter the local MDB file path).')
      return null
    }
    const formData = new FormData()
    if (mdbFile) {
      formData.append('file', mdbFile)
    } else if (mdbFileToken) {
      formData.append('file_token', mdbFileToken)
    }
    if (mdbPath.trim() && !mdbFile) {
      formData.append('mdb_path', mdbPath.trim())
    }
    formData.append('mdb_password', mdbPassword)

    const data = await api.upload<{
      ok: boolean
      message: string
      file_token: string | null
      file_name: string | null
      tables: MdbTable[]
      ipd_service_master_count: number
      has_cash_payment_mode: boolean
    }>('/hospital/admin/mdb-migrate/inspect', formData)

    setMdbFileToken(data.file_token || null)
    setMdbLoadedName(data.file_name || null)
    setMdbTables(data.tables || [])
    setMdbServiceCount(data.ipd_service_master_count ?? null)
    append(
      `${data.message} IPD services in Service Master: ${data.ipd_service_master_count}.` +
        (data.has_cash_payment_mode ? '' : ' Warning: no active Cash payment mode found.'),
    )
    return data.file_token || null
  }

  async function testMdb() {
    setBusy(true)
    setError(null)
    try {
      await inspectMdb()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function runMdb() {
    const selected = Object.entries(mdbSelected)
      .filter(([, on]) => on)
      .map(([key]) => key)
    if (!password.trim()) {
      fail('Enter the migration password (2015 — same password as Reset Database).')
      return
    }
    if (!selected.length) {
      fail('Select at least one table to migrate.')
      return
    }
    if (!mdbFile && !mdbFileToken && !mdbPath.trim()) {
      fail('Select an .mdb file (or enter the local MDB file path).')
      return
    }
    setBusy(true)
    setError(null)
    setLog('')
    setProgress({ percent: 0, message: 'Preparing MDB file…' })
    let seenLogs = 0
    try {
      let tokenToUse = mdbFileToken
      if (mdbFile && !tokenToUse) {
        tokenToUse = await inspectMdb()
      }
      await api.post('/hospital/admin/mdb-migrate/start', {
        password,
        mdb_password: mdbPassword,
        file_token: tokenToUse,
        mdb_path: tokenToUse ? null : mdbPath.trim() || null,
        selected_keys: selected,
        replace_existing: replaceExisting,
        dry_run: dryRun,
      })
      while (true) {
        const job = await api.get<{
          running: boolean
          done: boolean
          percent: number
          message: string
          error: string | null
          log_lines?: string[]
        }>('/hospital/admin/mdb-migrate/progress')
        const message = job.message || 'Working…'
        setProgress({ percent: Number(job.percent) || 0, message })
        if (Array.isArray(job.log_lines) && job.log_lines.length > seenLogs) {
          for (const line of job.log_lines.slice(seenLogs)) {
            append(line)
          }
          seenLogs = job.log_lines.length
        }
        if (job.error) {
          setError(job.error)
          break
        }
        if (job.done) break
        if (!job.running) {
          fail('MDB migration stopped before it finished. Click Run Migration again.')
          break
        }
        await new Promise((resolve) => window.setTimeout(resolve, 400))
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function fail(message: string) {
    setError(message)
    append(message)
  }

  async function runFox() {
    const selected = Object.entries(foxSelected)
      .filter(([, on]) => on)
      .map(([key]) => key)
    if (!password.trim()) {
      fail('Enter the maintenance password. It is the same password as Reset Database.')
      return
    }
    if (!selected.length) {
      fail('Select at least one FoxPro table.')
      return
    }
    setBusy(true)
    setError(null)
    setLog('')
    try {
      await readStream(
        '/hospital/admin/legacy-migrate/run-stream',
        {
          password,
          mysql_connection_string: mysqlUrl,
          postgres_connection_string: pgUrl,
          selected_keys: selected,
          mappings: foxMappings.map((row) => ({
            key: row.key,
            legacy_table: row.legacy_table,
            source_filter: row.source_filter,
          })),
          replace_existing: replaceExisting,
          dry_run: dryRun,
        },
        (event) => {
          if (event.type === 'error') fail(String(event.message || 'Migration failed'))
          const line = describeEvent(event)
          if (line) append(line)
        },
      )
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function runPrevious() {
    const selected = Object.entries(prevSelected)
      .filter(([, on]) => on)
      .map(([key]) => key)
    if (!password.trim()) {
      fail('Enter the maintenance password. It is the same password as Reset Database.')
      return
    }
    if (!selected.length) {
      fail('Select at least one table.')
      return
    }
    setBusy(true)
    setError(null)
    setLog('')
    setProgress({ percent: 0, message: 'Starting migration…' })
    let lastLine = ''
    try {
      await api.post('/hospital/admin/previous-migrate/start', {
        password,
        source_url: sourceUrl,
        selected_keys: selected,
        replace_existing: replaceExisting,
        dry_run: dryRun,
      })
      while (true) {
        const job = await api.get<{
          running: boolean
          done: boolean
          percent: number
          message: string
          error: string | null
          imported: number
        }>('/hospital/admin/previous-migrate/progress')
        const message = job.message || 'Working…'
        setProgress({ percent: Number(job.percent) || 0, message })
        if (job.error) {
          fail(job.error)
          break
        }
        if (message && message !== lastLine) {
          lastLine = message
          append(message)
        }
        if (job.done) break
        if (!job.running) {
          fail('Migration stopped before it finished. Click Run Migration again.')
          break
        }
        await new Promise((resolve) => window.setTimeout(resolve, 400))
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="hms-page">
        <h1>Database Migration</h1>
        <div className="hms-error">Only a Super Admin can run database migration.</div>
      </div>
    )
  }

  return (
    <div className="hms-page">
      <h1>Database Migration</h1>
      <div className="hms-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'foxpro'}
          className={`hms-tab${tab === 'foxpro' ? ' active' : ''}`}
          onClick={() => {
            setTab('foxpro')
            setReplaceExisting(false)
            setError(null)
          }}
        >
          From FoxPro
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'previous'}
          className={`hms-tab${tab === 'previous' ? ' active' : ''}`}
          onClick={() => {
            setTab('previous')
            setReplaceExisting(true)
            setError(null)
          }}
        >
          From previous hospital version
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'mdb'}
          className={`hms-tab${tab === 'mdb' ? ' active' : ''}`}
          onClick={() => {
            setTab('mdb')
            setReplaceExisting(false)
            setError(null)
          }}
        >
          Migrate from MDB
        </button>
      </div>

      {error ? <div className="hms-error">{error}</div> : null}

      {tab === 'foxpro' ? (
        <>
          <p className="hint">
            Same import as the previous hospital version: the old FoxPro hospital data is read
            through MySQL (pmaster, dmaster, trn, csh, and the other year tables) and written
            into this database. Patients are also created as parties.
          </p>
          <div className="hms-box">
            <div className="hms-box-title">Connection</div>
            <div className="hms-form-row">
              <label htmlFor="fox-mysql">MySQL (FoxPro source)</label>
              <input
                id="fox-mysql"
                className="hms-field"
                value={mysqlUrl}
                onChange={(e) => setMysqlUrl(e.target.value)}
              />
            </div>
            <div className="hms-actions">
              <button className="hms-btn" type="button" disabled={busy} onClick={() => void testMysql()}>
                Test MySQL
              </button>
              <button className="hms-btn" type="button" disabled={busy} onClick={() => void refreshFoxCounts()}>
                Refresh source counts
              </button>
            </div>
            <div className="hms-form-row">
              <label htmlFor="fox-pg">PostgreSQL (this database)</label>
              <input id="fox-pg" className="hms-field" value={pgUrl} onChange={(e) => setPgUrl(e.target.value)} />
            </div>
          </div>
          {foxGroups.map(([group, rows]) => (
            <div className="hms-box" key={group}>
              <div className="hms-box-title">{group}</div>
              {rows.map((row) => (
                <div key={row.key} style={{ display: 'grid', gridTemplateColumns: '220px 140px 1fr', gap: 8, marginBottom: 6 }}>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(foxSelected[row.key])}
                      onChange={(e) => setFoxSelected((s) => ({ ...s, [row.key]: e.target.checked }))}
                    />{' '}
                    {row.label}
                    {row.source_rows != null ? ` (${row.exists === false ? 'missing' : row.source_rows})` : ''}
                  </label>
                  <input
                    className="hms-field"
                    value={row.legacy_table}
                    onChange={(e) => patchFox(row.key, { legacy_table: e.target.value })}
                  />
                  <input
                    className="hms-field"
                    value={row.source_filter}
                    onChange={(e) => patchFox(row.key, { source_filter: e.target.value })}
                  />
                </div>
              ))}
            </div>
          ))}
        </>
      ) : tab === 'previous' ? (
        <>
          <p className="hint">
            For a hospital that is already on the previous version (the PostgreSQL database from
            that install, usually named hms). Rows are copied into this version. Patients get a
            party record. Users and menus stay as they are unless you tick that group.
          </p>
          <div className="hms-box">
            <div className="hms-box-title">Previous database</div>
            <div className="hms-form-row">
              <label htmlFor="prev-url">PostgreSQL connection</label>
              <input
                id="prev-url"
                className="hms-field"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
              />
            </div>
            <div className="hms-actions">
              <button className="hms-btn" type="button" disabled={busy} onClick={() => void testPrevious()}>
                Test connection and refresh counts
              </button>
            </div>
          </div>
          {prevGroups.map(([group, rows]) => (
            <div className="hms-box" key={group}>
              <div className="hms-box-title">{group}</div>
              {rows.map((row) => (
                <label key={row.key} style={{ display: 'block', marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(prevSelected[row.key])}
                    onChange={(e) => setPrevSelected((s) => ({ ...s, [row.key]: e.target.checked }))}
                  />{' '}
                  {row.label}
                  {row.source_rows != null ? ` (${row.source_rows})` : ''}
                  {row.notes ? <span className="hint"> — {row.notes}</span> : null}
                </label>
              ))}
            </div>
          ))}
        </>
      ) : (
        <>
          <p className="hint">
            Migrate Patient Master (OPDMAST) and IPD Bills (IPDBILL) directly from an MS Access
            (.mdb) file. IPD service codes (CD) are matched against IPD services in Service Master,
            each line uses amount as rate with quantity 1, and all bills are recorded as Cash.
          </p>
          <div className="hms-box">
            <div className="hms-box-title">MDB Source File</div>
            <div className="hms-form-row">
              <label htmlFor="mdb-file">Select MDB file</label>
              <input
                id="mdb-file"
                className="hms-field"
                type="file"
                accept=".mdb,.accdb"
                disabled={busy}
                onChange={(e) => {
                  const picked = e.target.files?.[0] || null
                  setMdbFile(picked)
                  setMdbFileToken(null)
                  setMdbLoadedName(null)
                  setError(null)
                }}
              />
            </div>
            <div className="hms-form-row">
              <label htmlFor="mdb-path">Or local file path (optional)</label>
              <input
                id="mdb-path"
                className="hms-field"
                value={mdbPath}
                disabled={busy}
                onChange={(e) => {
                  setMdbPath(e.target.value)
                  if (e.target.value.trim()) {
                    setMdbFile(null)
                    setMdbFileToken(null)
                  }
                }}
                placeholder="e.g. C:\Users\Administrator\Desktop\KAUMUDI.mdb"
              />
            </div>
            <div className="hms-form-row">
              <label htmlFor="mdb-password">MDB file password</label>
              <input
                id="mdb-password"
                className="hms-field"
                type="password"
                value={mdbPassword}
                disabled={busy}
                onChange={(e) => setMdbPassword(e.target.value)}
                placeholder="Password for the .mdb file (leave blank if none)"
              />
            </div>
            <div className="hms-actions">
              <button className="hms-btn" type="button" disabled={busy} onClick={() => void testMdb()}>
                Test &amp; Load MDB
              </button>
              {mdbLoadedName ? (
                <span className="hint">
                  Loaded: <strong>{mdbLoadedName}</strong>
                  {mdbServiceCount != null ? ` · IPD services in master: ${mdbServiceCount}` : ''}
                </span>
              ) : null}
            </div>
          </div>
          <div className="hms-box">
            <div className="hms-box-title">Tables to migrate</div>
            {mdbTables.map((row) => (
              <label key={row.key} style={{ display: 'block', marginBottom: 6 }}>
                <input
                  type="checkbox"
                  checked={Boolean(mdbSelected[row.key])}
                  disabled={busy}
                  onChange={(e) => setMdbSelected((s) => ({ ...s, [row.key]: e.target.checked }))}
                />{' '}
                {row.label}
                {row.count_label ? ` (${row.count_label})` : ''}
                {row.notes ? <span className="hint"> — {row.notes}</span> : null}
              </label>
            ))}
          </div>
        </>
      )}

      <div className="hms-box">
        <div className="hms-box-title">Run</div>
        <div className="hms-form-row">
          <label htmlFor="mig-password">Maintenance password</label>
          <input
            id="mig-password"
            className="hms-field"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Same password as Reset Database"
          />
        </div>
        <label style={{ display: 'block', marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(e) => setReplaceExisting(e.target.checked)}
          />{' '}
          Replace existing rows in the selected tables
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Dry
          run (read only — nothing is saved)
        </label>
        {error ? <div className="hms-error">{error}</div> : null}
        {(tab === 'previous' || tab === 'mdb') && progress ? (
          <div>
            <div className="hms-progress-label">{progress.message}</div>
            <div className="hms-progress" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${Math.max(0, Math.min(progress.percent, 100))}%` }} />
            </div>
          </div>
        ) : null}
        <div className="hms-actions">
          <button
            className="hms-btn hms-btn-navy"
            type="button"
            disabled={busy}
            onClick={() =>
              void (tab === 'foxpro' ? runFox() : tab === 'previous' ? runPrevious() : runMdb())
            }
          >
            {busy
              ? tab === 'previous' || tab === 'mdb'
                ? `Migrating ${progress?.percent ?? 0}%`
                : 'Working…'
              : dryRun
                ? 'Dry run'
                : 'Run Migration'}
          </button>
        </div>
        <div className="hms-log">{log || 'Log'}</div>
      </div>
    </div>
  )
}
