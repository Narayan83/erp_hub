import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ListPager } from '../../components/generp/ListPager'
import { Typeahead } from '../../components/generp/Typeahead'
import { downloadExcel, type SpreadsheetFormat } from '../../lib/generp/exportExcel'
import { LIST_PAGE_SIZE, useClientPager } from '../../lib/generp/paginate'
import { fmt, parseNum } from '../../lib/generp/saleBillMath'
import type { Category, DiscountScheme, Product } from '../../generpTypes'

type FormState = {
  code: string
  name: string
  scope: string
  discount_type: string
  value: number
  min_bill_amount: number
  max_discount_amount: string
  product_id: string
  productText: string
  category_id: string
  valid_from: string
  valid_to: string
  applies_to: string
  narration: string
  is_active: boolean
}

const EMPTY: FormState = {
  code: '',
  name: '',
  scope: 'BILL',
  discount_type: 'PCT',
  value: 0,
  min_bill_amount: 0,
  max_discount_amount: '',
  product_id: '',
  productText: '',
  category_id: '',
  valid_from: '',
  valid_to: '',
  applies_to: 'ALL',
  narration: '',
  is_active: true,
}

const SCOPES = ['BILL', 'LINE', 'PRODUCT', 'CATEGORY'] as const
const DISCOUNT_TYPES = ['PCT', 'AMT'] as const
const APPLIES_TO = ['ALL', 'SALE', 'WHOLESALE'] as const

function schemeToForm(s: DiscountScheme, productText = '', categoryId = ''): FormState {
  return {
    code: s.code || '',
    name: s.name || '',
    scope: s.scope || 'BILL',
    discount_type: s.discount_type || 'PCT',
    value: Number(s.value || 0),
    min_bill_amount: Number(s.min_bill_amount || 0),
    max_discount_amount:
      s.max_discount_amount != null && s.max_discount_amount !== ''
        ? String(s.max_discount_amount)
        : '',
    product_id: s.product_id || '',
    productText,
    category_id: s.category_id || categoryId,
    valid_from: s.valid_from || '',
    valid_to: s.valid_to || '',
    applies_to: s.applies_to || 'ALL',
    narration: s.narration || '',
    is_active: s.is_active !== false,
  }
}

function payloadFromForm(form: FormState) {
  return {
    code: form.code.trim().toUpperCase(),
    name: form.name.trim(),
    scope: form.scope,
    discount_type: form.discount_type,
    value: form.value,
    min_bill_amount: form.min_bill_amount,
    max_discount_amount: form.max_discount_amount.trim()
      ? parseNum(form.max_discount_amount)
      : null,
    product_id: form.product_id || null,
    category_id: form.category_id || null,
    valid_from: form.valid_from || null,
    valid_to: form.valid_to || null,
    applies_to: form.applies_to,
    narration: form.narration.trim() || null,
    is_active: form.is_active,
  }
}

export function DiscountMasterPage() {
  const [schemes, setSchemes] = useState<DiscountScheme[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [query, setQuery] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const [testSchemeId, setTestSchemeId] = useState('')
  const [testBillAmount, setTestBillAmount] = useState('1000')
  const [testVoucherType, setTestVoucherType] = useState('SALE')
  const [testResult, setTestResult] = useState('')

  const searchProducts = useCallback(async (q: string) => {
    const term = q.trim()
    if (!term) return []
    return api.get<Product[]>('/products', { q: term, limit: 20 })
  }, [])

  const productLabel = useCallback(
    (p: Product) => `${p.code || ''} — ${p.name || ''}`,
    [],
  )

  const load = useCallback(async () => {
    const [rows, cats] = await Promise.all([
      api.get<DiscountScheme[]>('/discounts/discount-schemes'),
      api.get<Category[]>('/categories'),
    ])
    setSchemes(rows)
    setCategories(cats)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await load()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load schemes')
      }
    })()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return schemes
    return schemes.filter(
      (s) =>
        s.code.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.scope.toLowerCase().includes(q),
    )
  }, [schemes, query])

  const pager = useClientPager(filtered, query, LIST_PAGE_SIZE)

  const exportRows = (format: SpreadsheetFormat = 'xlsx') => {
    downloadExcel('discount-schemes', {
      name: 'Discounts',
      headers: ['Code', 'Name', 'Scope', 'Type', 'Value', 'Min bill', 'Applies to', 'Active'],
      rows: filtered.map((s) => [
        s.code,
        s.name,
        s.scope,
        s.discount_type,
        Number(s.value || 0),
        Number(s.min_bill_amount || 0),
        s.applies_to || '',
        s.is_active === false ? 'No' : 'Yes',
      ]),
    }, format)
  }

  const select = async (s: DiscountScheme) => {
    setEditId(s.id)
    setError('')
    setStatus('')
    let productText = ''
    if (s.product_id) {
      try {
        const p = await api.get<Product>(`/products/${s.product_id}`)
        productText = productLabel(p)
      } catch {
        productText = s.product_id
      }
    }
    setForm(schemeToForm(s, productText))
    setTestSchemeId(s.id)
  }

  const reset = () => {
    setEditId(null)
    setForm(EMPTY)
    setError('')
    setStatus('')
    setTestResult('')
  }

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      setError('Code and name are required.')
      return
    }
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const payload = payloadFromForm(form)
      if (editId) {
        await api.put(`/discounts/discount-schemes/${editId}`, payload)
        setStatus('Scheme updated.')
      } else {
        const created = await api.post<DiscountScheme>('/discounts/discount-schemes', payload)
        setTestSchemeId(created.id)
        setStatus('Scheme created.')
      }
      await load()
      if (editId) reset()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!editId) return
    if (!confirm('Deactivate this discount scheme?')) return
    setBusy(true)
    setError('')
    try {
      try {
        await api.delete(`/discounts/discount-schemes/${editId}`)
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 405) {
          await api.put(`/discounts/discount-schemes/${editId}`, {
            ...payloadFromForm(form),
            is_active: false,
          })
        } else {
          throw err
        }
      }
      setStatus('Scheme deactivated.')
      await load()
      reset()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const testApply = async () => {
    setBusy(true)
    setTestResult('')
    setError('')
    try {
      const result = await api.post<{
        discount_amount: number | string
        scheme_code?: string | null
        scheme_name?: string | null
      }>('/discounts/discount-schemes/apply', {
        scheme_id: testSchemeId || editId || null,
        bill_amount: parseNum(testBillAmount),
        voucher_type: testVoucherType,
        product_id: form.product_id || null,
        category_id: form.category_id || null,
      })
      setTestResult(
        `Discount: ${fmt(Number(result.discount_amount))}` +
          (result.scheme_code ? ` (${result.scheme_code} — ${result.scheme_name})` : ''),
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Apply test failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="master-page">
      <h2>Discount Master</h2>
      <p className="hint">Configure bill, line, product, and category discount schemes.</p>
      {error && <div className="error-banner">{error}</div>}
      {status && <p className="hint">{status}</p>}

      <div className="master-grid">
        <aside className="master-list">
          <input
            className="input"
            placeholder="Search schemes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="master-list-toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={reset}>
              + New Scheme
            </button>
            <ListPager
              compact
              page={pager.page}
              totalPages={pager.totalPages}
              total={pager.total}
              pageSize={pager.pageSize}
              onPage={pager.setPage}
              onExport={exportRows}
            />
          </div>
          <div className="master-list-scroll">
            {pager.pageRows.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`master-list-item${editId === s.id ? ' active' : ''}`}
                onClick={() => void select(s)}
              >
                <strong>{s.code}</strong>
                <span>{s.name}</span>
                <small>
                  {s.scope} · {s.discount_type} {s.value}
                  {s.is_active === false ? ' · Inactive' : ''}
                </small>
              </button>
            ))}
          </div>
        </aside>

        <div className="master-form">
          <div className="settings-box">
            <div className="settings-field-row">
              <label className="settings-field">
                <span>Code *</span>
                <input
                  className="input"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                />
              </label>
              <label className="settings-field">
                <span>Name *</span>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
            </div>
            <div className="settings-field-row">
              <label className="settings-field">
                <span>Scope</span>
                <select
                  className="input"
                  value={form.scope}
                  onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
                >
                  {SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span>Discount Type</span>
                <select
                  className="input"
                  value={form.discount_type}
                  onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value }))}
                >
                  {DISCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span>Value</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={form.value}
                  onChange={(e) => setForm((f) => ({ ...f, value: parseNum(e.target.value) }))}
                />
              </label>
            </div>
            <div className="settings-field-row">
              <label className="settings-field">
                <span>Min Bill Amount</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={form.min_bill_amount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, min_bill_amount: parseNum(e.target.value) }))
                  }
                />
              </label>
              <label className="settings-field">
                <span>Max Discount</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  placeholder="Optional"
                  value={form.max_discount_amount}
                  onChange={(e) => setForm((f) => ({ ...f, max_discount_amount: e.target.value }))}
                />
              </label>
              <label className="settings-field">
                <span>Applies To</span>
                <select
                  className="input"
                  value={form.applies_to}
                  onChange={(e) => setForm((f) => ({ ...f, applies_to: e.target.value }))}
                >
                  {APPLIES_TO.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {(form.scope === 'PRODUCT' || form.product_id) && (
              <label className="settings-field">
                <span>Product</span>
                <Typeahead
                  value={form.productText}
                  onChange={(v) => setForm((f) => ({ ...f, productText: v, product_id: '' }))}
                  onSelect={(p) =>
                    setForm((f) => ({
                      ...f,
                      product_id: p.id,
                      productText: productLabel(p),
                      category_id: p.category_id || f.category_id,
                    }))
                  }
                  searchItems={searchProducts}
                  getLabel={productLabel}
                  getKey={(p) => p.id}
                  placeholder="Search product"
                />
              </label>
            )}
            {(form.scope === 'CATEGORY' || form.category_id) && (
              <label className="settings-field">
                <span>Category</span>
                <select
                  className="input"
                  value={form.category_id}
                  onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
                >
                  <option value="">— None —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code ? `${c.code} — ` : ''}
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="settings-field-row">
              <label className="settings-field">
                <span>Valid From</span>
                <input
                  className="input"
                  type="date"
                  value={form.valid_from}
                  onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))}
                />
              </label>
              <label className="settings-field">
                <span>Valid To</span>
                <input
                  className="input"
                  type="date"
                  value={form.valid_to}
                  onChange={(e) => setForm((f) => ({ ...f, valid_to: e.target.value }))}
                />
              </label>
            </div>
            <label className="settings-field">
              <span>Narration</span>
              <input
                className="input"
                value={form.narration}
                onChange={(e) => setForm((f) => ({ ...f, narration: e.target.value }))}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              />{' '}
              Active
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
                {editId ? 'Update' : 'Create'}
              </button>
              {editId && (
                <button type="button" className="btn" disabled={busy} onClick={() => void remove()}>
                  Deactivate
                </button>
              )}
              <button type="button" className="btn" onClick={reset}>
                Clear
              </button>
            </div>
          </div>

          <div className="settings-box" style={{ marginTop: 16 }}>
            <h3>Test Apply</h3>
            <div className="settings-field-row">
              <label className="settings-field">
                <span>Scheme</span>
                <select
                  className="input"
                  value={testSchemeId}
                  onChange={(e) => setTestSchemeId(e.target.value)}
                >
                  <option value="">Current form / selected</option>
                  {schemes
                    .filter((s) => s.is_active !== false)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="settings-field">
                <span>Bill Amount</span>
                <input
                  className="input"
                  value={testBillAmount}
                  onChange={(e) => setTestBillAmount(e.target.value)}
                />
              </label>
              <label className="settings-field">
                <span>Voucher Type</span>
                <select
                  className="input"
                  value={testVoucherType}
                  onChange={(e) => setTestVoucherType(e.target.value)}
                >
                  <option value="SALE">SALE</option>
                  <option value="WHOLESALE">WHOLESALE</option>
                </select>
              </label>
            </div>
            <button type="button" className="btn" disabled={busy} onClick={() => void testApply()}>
              Test Apply
            </button>
            {testResult && <p className="hint">{testResult}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
