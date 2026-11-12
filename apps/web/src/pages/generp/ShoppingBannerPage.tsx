import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ListPager } from '../../components/generp/ListPager'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { LIST_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'

type ShopBanner = {
  id: string
  title: string
  file_path: string
  image_url: string
  sort_order: number
  is_active: boolean
}

export function ShoppingBannerPage() {
  const [rows, setRows] = useState<ShopBanner[]>([])
  const [title, setTitle] = useState('Shop')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await api.get<ShopBanner[]>('/shop/banners')
      setRows(list)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load banners')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const pager = useClientPager(rows, rows.length, LIST_PAGE_SIZE)

  const exportRows = (format: SpreadsheetFormat = 'xlsx') => {
    downloadExcel('shop-banners', {
      name: 'Banners',
      headers: ['Title', 'Active', 'Sort', 'Image'],
      rows: rows.map((b) => [b.title, b.is_active ? 'Yes' : 'No', b.sort_order, b.image_url]),
    }, format)
  }

  const onUpload = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', title.trim() || 'Shop')
      await api.upload<ShopBanner>('/shop/banners', fd)
      setTitle('Shop')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (b: ShopBanner) => {
    setBusy(true)
    try {
      await api.patch(`/shop/banners/${b.id}`, { is_active: !b.is_active })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (b: ShopBanner) => {
    if (!confirm('Delete this banner?')) return
    setBusy(true)
    try {
      await api.delete(`/shop/banners/${b.id}`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <h2 style={{ marginTop: 0 }}>Shopping Cart — Banner Upload</h2>
      <p className="hint">
        Upload storefront hero banners. Active banners rotate / show on the Shop page (first active is used).
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="settings-box">
        <div className="settings-box-title">Upload banner</div>
        <label className="settings-field">
          <span>Title text (overlay)</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => {
            void onUpload(e.target.files?.[0] ?? null)
            e.target.value = ''
          }}
        />
        <p className="hint">Recommended wide image (e.g. 1600×400). JPEG / PNG / WebP, max 8 MB.</p>
      </div>

      <div className="settings-box">
        <div className="settings-box-title">Banners ({rows.length})</div>
        {rows.length === 0 ? (
          <p className="hint">No banners yet. Upload one above.</p>
        ) : (
          <>
            <div className="hn-banner-admin-grid">
              {pager.pageRows.map((b) => (
                <article key={b.id} className="hn-banner-admin-card">
                  <img src={b.image_url} alt={b.title} />
                  <div className="hn-banner-admin-meta">
                    <strong>{b.title}</strong>
                    <span className="hint">{b.is_active ? 'Active' : 'Inactive'}</span>
                    <div className="hn-banner-admin-actions">
                      <button type="button" className="btn" disabled={busy} onClick={() => void toggleActive(b)}>
                        {b.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button type="button" className="btn" disabled={busy} onClick={() => void remove(b)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <ListPager
              page={pager.page}
              totalPages={pager.totalPages}
              total={pager.total}
              pageSize={pager.pageSize}
              onPage={pager.setPage}
              onExport={exportRows}
            />
          </>
        )}
      </div>
    </div>
  )
}
