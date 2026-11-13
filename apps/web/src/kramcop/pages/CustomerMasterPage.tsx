import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { AuthImage } from '../components/AuthImage'
import { KannadaInput } from '../components/KannadaInput'
import { englishToKannada } from '../lib/kannada'
import { emptyMember, type Category, type Member, type MemberList, type ShareType } from '../types'

type Form = Omit<Member, 'id' | 'name_kn' | 'name_en' | 'share_nos' | 'has_photo' | 'has_sign'>

function toForm(m: Member): Form {
  return {
    acno: m.acno,
    shac: m.shac,
    first_en: m.first_en,
    first_kn: m.first_kn,
    second_en: m.second_en,
    second_kn: m.second_kn,
    third_en: m.third_en,
    third_kn: m.third_kn,
    village_en: m.village_en,
    village_kn: m.village_kn,
    post_en: m.post_en,
    post_kn: m.post_kn,
    taluk_en: m.taluk_en,
    taluk_kn: m.taluk_kn,
    dist_en: m.dist_en,
    dist_kn: m.dist_kn,
    pin: m.pin,
    category: m.category || 'G',
    sex: m.sex,
    mobile: m.mobile,
    phone: m.phone,
    closed: m.closed,
    share_type_code: m.share_type_code || 4,
  }
}

export function CustomerMasterPage() {
  const [rows, setRows] = useState<Member[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<Form>(emptyMember())
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [autoKn, setAutoKn] = useState(true)
  const [heldShares, setHeldShares] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [types, setTypes] = useState<ShareType[]>([])
  const [hasPhoto, setHasPhoto] = useState(false)
  const [hasSign, setHasSign] = useState(false)
  const [stamp, setStamp] = useState(0)

  const load = useCallback(async (p = 1, q = query) => {
    const res = await api.get<MemberList>('/members', { q, page: p, page_size: 40 })
    setRows(res.items)
    setTotal(res.total)
    setPage(res.page)
    if (!editId) {
      setForm((f) => (f.first_en || f.first_kn ? f : { ...f, acno: res.next_acno }))
    }
  }, [query, editId])

  useEffect(() => {
    void load(1, query).catch((err: Error) => setError(err.message))
  }, [query, load])

  useEffect(() => {
    api.get<Category[]>('/categories').then(setCategories).catch(() => undefined)
    api.get<ShareType[]>('/share-types').then(setTypes).catch(() => undefined)
  }, [])

  const setEn = (key: keyof Form, knKey: keyof Form, val: string) => {
    setForm((f) => ({
      ...f,
      [key]: val,
      ...(autoKn ? { [knKey]: englishToKannada(val) } : {}),
    }))
  }

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      const body = { ...form, auto_kannada: autoKn }
      const saved = editId
        ? await api.put<Member>(`/members/${editId}`, body)
        : await api.post<Member>('/members', body)
      setEditId(saved.id)
      setHeldShares(saved.share_nos)
      setHasPhoto(!!saved.has_photo)
      setHasSign(!!saved.has_sign)
      await load(page, query)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const edit = (m: Member) => {
    setEditId(m.id)
    setForm(toForm(m))
    setHeldShares(m.share_nos)
    setHasPhoto(!!m.has_photo)
    setHasSign(!!m.has_sign)
    setStamp(Date.now())
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const remove = async (m: Member) => {
    if (!confirm(`Delete ACNO ${m.acno}?`)) return
    await api.del(`/members/${m.id}`)
    await load(page, query)
  }

  const upload = async (kind: 'photo' | 'sign', file: File | undefined) => {
    if (!editId || !file) {
      setError('Save the member first, then upload photo / signature')
      return
    }
    await api.upload(`/members/${editId}/${kind}`, file)
    if (kind === 'photo') setHasPhoto(true)
    else setHasSign(true)
    setStamp(Date.now())
    await load(page, query)
  }

  const pages = Math.max(1, Math.ceil(total / 40))

  return (
    <div>
      <h1>Customer Master</h1>
      <p className="hint">
        English fields stay English. Kannada fields convert English typing to Unicode Kannada. Category and share type
        come from their masters. Upload photo and signature after the member is saved.
      </p>
      {error && <div className="error">{error}</div>}

      <div className="panel">
        <div className="row">
          <label>
            ACNO
            <input className="input" type="number" value={form.acno} onChange={(e) => setForm({ ...form, acno: Number(e.target.value) })} />
          </label>
          <label>
            SHAC
            <input className="input" value={form.shac} onChange={(e) => setForm({ ...form, shac: e.target.value })} />
          </label>
          <label>
            Share no. (from RNO)
            <input className="input" value={heldShares} readOnly placeholder="Set via Share addition / deletion" />
          </label>
          <label>
            Category
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {categories.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.code} · {c.name_en}
                </option>
              ))}
            </select>
          </label>
          <label>
            Share type
            <select className="input" value={form.share_type_code} onChange={(e) => setForm({ ...form, share_type_code: Number(e.target.value) })}>
              {types.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.code} · {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sex
            <select className="input" value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}>
              <option value="">Select</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Others">Others</option>
            </select>
          </label>
          <label>
            Mobile
            <input className="input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          </label>
          <label>
            Phone
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={autoKn} onChange={(e) => setAutoKn(e.target.checked)} />
            Auto Kannada from English
          </label>
        </div>

        <div className="media-row">
          <div>
            <div className="muted">Photo</div>
            {editId && hasPhoto ? (
              <AuthImage key={`p-${stamp}`} path={`/members/${editId}/photo`} alt="Photo" className="snap-photo" />
            ) : (
              <div className="photo-ph">No photo</div>
            )}
            <input type="file" accept="image/*" onChange={(e) => void upload('photo', e.target.files?.[0])} />
          </div>
          <div>
            <div className="muted">Signature</div>
            {editId && hasSign ? (
              <AuthImage key={`s-${stamp}`} path={`/members/${editId}/sign`} alt="Sign" className="snap-sign" />
            ) : (
              <div className="photo-ph sign">No signature</div>
            )}
            <input type="file" accept="image/*" onChange={(e) => void upload('sign', e.target.files?.[0])} />
          </div>
        </div>

        <div className="grid2">
          <label>
            Name (English)
            <input className="input" value={form.first_en} onChange={(e) => setEn('first_en', 'first_kn', e.target.value)} />
          </label>
          <label>
            Name (Kannada)
            <KannadaInput value={form.first_kn} onChange={(v) => setForm({ ...form, first_kn: v })} />
          </label>
          <label>
            Father / second (English)
            <input className="input" value={form.second_en} onChange={(e) => setEn('second_en', 'second_kn', e.target.value)} />
          </label>
          <label>
            Father / second (Kannada)
            <KannadaInput value={form.second_kn} onChange={(v) => setForm({ ...form, second_kn: v })} />
          </label>
          <label>
            Third (English)
            <input className="input" value={form.third_en} onChange={(e) => setEn('third_en', 'third_kn', e.target.value)} />
          </label>
          <label>
            Third (Kannada)
            <KannadaInput value={form.third_kn} onChange={(v) => setForm({ ...form, third_kn: v })} />
          </label>
          <label>
            AT / Village (English)
            <input className="input" value={form.village_en} onChange={(e) => setEn('village_en', 'village_kn', e.target.value)} />
          </label>
          <label>
            AT / Village (Kannada)
            <KannadaInput value={form.village_kn} onChange={(v) => setForm({ ...form, village_kn: v })} />
          </label>
          <label>
            PO (English)
            <input className="input" value={form.post_en} onChange={(e) => setEn('post_en', 'post_kn', e.target.value)} />
          </label>
          <label>
            PO (Kannada)
            <KannadaInput value={form.post_kn} onChange={(v) => setForm({ ...form, post_kn: v })} />
          </label>
          <label>
            Taluk (English)
            <input className="input" value={form.taluk_en} onChange={(e) => setEn('taluk_en', 'taluk_kn', e.target.value)} />
          </label>
          <label>
            Taluk (Kannada)
            <KannadaInput value={form.taluk_kn} onChange={(v) => setForm({ ...form, taluk_kn: v })} />
          </label>
          <label>
            District (English)
            <input className="input" value={form.dist_en} onChange={(e) => setEn('dist_en', 'dist_kn', e.target.value)} />
          </label>
          <label>
            District (Kannada)
            <KannadaInput value={form.dist_kn} onChange={(v) => setForm({ ...form, dist_kn: v })} />
          </label>
          <label>
            PIN
            <input className="input" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} />
          </label>
        </div>
        <div className="actions">
          <button className="btn primary" type="button" onClick={() => void save()} disabled={busy}>
            {editId ? 'Update' : 'Save'} member
          </button>
          <button
            className="btn"
            type="button"
            onClick={async () => {
              setEditId(null)
              setHeldShares('')
              setHasPhoto(false)
              setHasSign(false)
              const peek = await api.get<MemberList>('/members', { page: 1, page_size: 1 })
              setForm(emptyMember(peek.next_acno))
            }}
          >
            New
          </button>
        </div>
      </div>

      <div className="toolbar">
        <input className="input search" placeholder="Search ACNO, name, village…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span>
          {total} members · page {page}/{pages}
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ACNO</th>
              <th>SHR NO</th>
              <th>Category</th>
              <th>Name</th>
              <th>Kannada</th>
              <th>AT</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td>{m.acno}</td>
                <td>{m.share_nos}</td>
                <td>{m.category}</td>
                <td>{m.name_en}</td>
                <td className="kn">{m.name_kn}</td>
                <td className="kn">{m.village_kn || m.village_en}</td>
                <td className="row-actions">
                  <button type="button" onClick={() => edit(m)}>
                    Edit
                  </button>
                  <Link to={`/share_entry?acno=${m.acno}`}>Entry</Link>
                  <button type="button" onClick={() => void remove(m)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button className="btn" type="button" disabled={page <= 1} onClick={() => void load(page - 1, query)}>
          Prev
        </button>
        <button className="btn" type="button" disabled={page >= pages} onClick={() => void load(page + 1, query)}>
          Next
        </button>
      </div>
    </div>
  )
}
