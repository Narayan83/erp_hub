import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api/client'
import type { Category, CompanyProfile, PaymentMode, Product, ProductImage, Voucher } from '../../generpTypes'

type CartLine = {
  product: Product
  qty: number
}

function money(n: number) {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function todayISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function primaryImage(p: Product): string | null {
  const imgs = p.images || []
  const main = imgs.find((i) => i.is_primary) || imgs[0]
  return main?.image_url || p.image_url || null
}

function saleRate(p: Product) {
  const n = Number(p.sale_price)
  return Number.isFinite(n) ? n : 0
}

function mrpRate(p: Product) {
  const n = Number(p.mrp)
  return Number.isFinite(n) ? n : 0
}

function discountPct(p: Product) {
  const mrp = mrpRate(p)
  const sale = saleRate(p)
  if (mrp <= 0 || sale <= 0 || sale >= mrp) return 0
  return Math.round(((mrp - sale) / mrp) * 100)
}

export function ShoppingCartPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [cardQty, setCardQty] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [q, setQ] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [onSaleOnly, setOnSaleOnly] = useState(false)
  const [inStockOnly, setInStockOnly] = useState(true)
  const [sortBy, setSortBy] = useState('default')

  const [detail, setDetail] = useState<Product | null>(null)
  const [detailImg, setDetailImg] = useState<string | null>(null)
  const [detailQty, setDetailQty] = useState(1)

  const [cartOpen, setCartOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [paymentModeId, setPaymentModeId] = useState('')
  const [orderMsg, setOrderMsg] = useState('')
  const [allowNegativeStock, setAllowNegativeStock] = useState(true)
  const [bannerUrl, setBannerUrl] = useState('/shop-banner.jpg')
  const [bannerTitle, setBannerTitle] = useState('Shop')

  const loadCatalog = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const rows = await api.get<Product[]>('/products', {
        is_in_shop: 'true',
        category_id: categoryId || undefined,
        price_min: priceMin.trim() || undefined,
        price_max: priceMax.trim() || undefined,
        q: q.trim() || undefined,
        limit: 200,
      })
      setProducts(rows)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load shop catalog')
    } finally {
      setBusy(false)
    }
  }, [categoryId, priceMin, priceMax, q])

  useEffect(() => {
    void (async () => {
      try {
        const [cats, modes, banners, profile] = await Promise.all([
          api.get<Category[]>('/categories'),
          api.get<PaymentMode[]>('/payment-modes'),
          api.get<{ id: string; title: string; image_url: string }[]>('/shop/banners', {
            active_only: 'true',
          }),
          api.get<CompanyProfile>('/company-profile').catch(() => null),
        ])
        setCategories(cats)
        setPaymentModes(modes)
        setAllowNegativeStock(profile?.allow_negative_stock !== false)
        const cash = modes.find((m) => m.is_cash) || modes[0]
        if (cash) setPaymentModeId(cash.id)
        if (banners?.length) {
          setBannerUrl(banners[0].image_url)
          setBannerTitle(banners[0].title || 'Shop')
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load filters')
      }
    })()
  }, [])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  const visible = useMemo(() => {
    let rows = [...products]
    if (onSaleOnly) rows = rows.filter((p) => discountPct(p) > 0)
    if (inStockOnly) {
      rows = rows.filter((p) => {
        const stock = Number(p.current_stock ?? p.opening_stock ?? 0)
        return stock > 0
      })
    }
    if (sortBy === 'price_asc') rows.sort((a, b) => saleRate(a) - saleRate(b))
    else if (sortBy === 'price_desc') rows.sort((a, b) => saleRate(b) - saleRate(a))
    else if (sortBy === 'name') rows.sort((a, b) => String(a.name).localeCompare(String(b.name)))
    return rows
  }, [products, onSaleOnly, inStockOnly, sortBy])

  const cartTotal = useMemo(
    () => cart.reduce((s, line) => s + saleRate(line.product) * line.qty, 0),
    [cart],
  )
  const cartCount = useMemo(() => cart.reduce((s, line) => s + line.qty, 0), [cart])

  const qtyOf = (id: string) => cardQty[id] ?? 1

  const addToCart = (product: Product, qty = 1) => {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.product.id === product.id)
      const nextQty = (i >= 0 ? prev[i].qty : 0) + qty
      if (!allowNegativeStock) {
        const stock = Number(product.current_stock ?? product.opening_stock ?? 0)
        if (nextQty > stock + 1e-9) {
          setError(
            `Insufficient stock for ${product.name}. Available ${stock}. Negative stock is not allowed.`,
          )
          return prev
        }
      }
      setError('')
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i], qty: nextQty }
        return next
      }
      return [...prev, { product, qty }]
    })
    setCartOpen(true)
  }

  const setCartLineQty = (productId: string, qty: number) => {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.product.id !== productId) return l
          if (!allowNegativeStock) {
            const stock = Number(l.product.current_stock ?? l.product.opening_stock ?? 0)
            if (qty > stock + 1e-9) {
              setError(
                `Insufficient stock for ${l.product.name}. Available ${stock}. Negative stock is not allowed.`,
              )
              return l
            }
          }
          return { ...l, qty }
        })
        .filter((l) => l.qty > 0),
    )
  }

  const openDetail = (p: Product) => {
    setDetail(p)
    setDetailImg(primaryImage(p))
    setDetailQty(1)
  }

  const clearFilters = () => {
    setQ('')
    setCategoryId('')
    setPriceMin('')
    setPriceMax('')
    setOnSaleOnly(false)
    setInStockOnly(true)
  }

  const placeOrder = async () => {
    if (!customerName.trim()) {
      setError('Customer name is required.')
      return
    }
    if (!paymentModeId) {
      setError('Select a payment mode.')
      return
    }
    if (cart.length === 0) {
      setError('Cart is empty.')
      return
    }
    if (!allowNegativeStock) {
      const short = cart.find((line) => {
        const stock = Number(line.product.current_stock ?? line.product.opening_stock ?? 0)
        return line.qty > stock + 1e-9
      })
      if (short) {
        setError(
          `Insufficient stock for ${short.product.name}. Available ${Number(short.product.current_stock ?? 0)}. Negative stock is not allowed.`,
        )
        return
      }
    }
    setBusy(true)
    setError('')
    setOrderMsg('')
    try {
      const party = await api.post<{ id: string }>('/parties/quick', {
        party_type: 'customer',
        name: customerName.trim(),
        phone: customerPhone.trim() || null,
      })
      const items = cart.map((line) => ({
        product_id: line.product.id,
        quantity: line.qty,
        rate: saleRate(line.product),
        discount_amount: 0,
        gst_id: line.product.gst_id || null,
      }))
          const voucher = await api.post<Voucher>('/vouchers', {
        voucher_type: 'SHOP_SALE',
        voucher_date: todayISO(),
        party_id: party.id,
        narration: customerAddress.trim()
          ? `Shop order · ${customerAddress.trim()}`
          : 'Shopping cart order',
        adjust_advance: 0,
        items,
        payments: [{ payment_mode_id: paymentModeId, amount: Number(cartTotal.toFixed(2)) }],
      })
      setCart([])
      setCheckoutOpen(false)
      setCartOpen(false)
      setCustomerName('')
      setCustomerPhone('')
      setCustomerAddress('')
      setOrderMsg(`Order placed successfully. Bill no: ${voucher.voucher_no || voucher.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to place order')
    } finally {
      setBusy(false)
    }
  }

  const detailImages: ProductImage[] = detail?.images?.length
    ? detail.images
    : detail?.image_url
      ? [
          {
            id: 'legacy',
            product_id: detail.id,
            file_path: '',
            image_url: detail.image_url,
            is_primary: true,
            sort_order: 0,
          },
        ]
      : []

  return (
    <div className="hn-shop">
      <div className="hn-shop-top">
        <div className="hn-shop-brand">GenERP Shop</div>
        <div className="hn-shop-tools">
          <div className="hn-search">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void loadCatalog()
              }}
              placeholder="Search products…"
            />
            <button type="button" onClick={() => void loadCatalog()} aria-label="Search">
              ⌕
            </button>
          </div>
          <button type="button" className="hn-cart-btn" onClick={() => setCartOpen(true)}>
            <span className="hn-cart-ico">🛒</span>
            <span>
              {cartCount} / {money(cartTotal)}
            </span>
          </button>
        </div>
      </div>

      <section className="hn-banner" style={{ backgroundImage: `url('${bannerUrl}')` }}>
        <div className="hn-banner-veil" />
        <h1>{bannerTitle}</h1>
      </section>

      {error && <div className="error-banner hn-msg">{error}</div>}
      {orderMsg && <div className="shop-success hn-msg">{orderMsg}</div>}

      <div className="hn-body">
        <aside className="hn-sidebar">
          <div className="hn-side-block">
            <h3>Stock status</h3>
            <label className="hn-check">
              <input
                type="checkbox"
                checked={onSaleOnly}
                onChange={(e) => setOnSaleOnly(e.target.checked)}
              />
              On sale
            </label>
            <label className="hn-check">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
              />
              In stock
            </label>
          </div>

          <div className="hn-side-block">
            <h3>Categories</h3>
            <button
              type="button"
              className={`hn-cat${!categoryId ? ' active' : ''}`}
              onClick={() => setCategoryId('')}
            >
              All categories
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`hn-cat${categoryId === c.id ? ' active' : ''}`}
                onClick={() => setCategoryId(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="hn-side-block">
            <h3>Price</h3>
            <div className="hn-price-row">
              <input
                type="number"
                min={0}
                placeholder="Min"
                value={priceMin}
                onChange={(e) => setPriceMin(e.target.value)}
              />
              <span>—</span>
              <input
                type="number"
                min={0}
                placeholder="Max"
                value={priceMax}
                onChange={(e) => setPriceMax(e.target.value)}
              />
            </div>
            <button type="button" className="hn-btn-outline" onClick={() => void loadCatalog()}>
              Apply filters
            </button>
            <button type="button" className="hn-link" onClick={clearFilters}>
              Clear all
            </button>
          </div>
        </aside>

        <div className="hn-main">
          <div className="hn-toolbar">
            <div className="hn-crumb">
              Home / <strong>Shop</strong>
            </div>
            <div className="hn-toolbar-right">
              <span className="hn-count">{visible.length} products</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="default">Default sorting</option>
                <option value="name">Sort by name</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
              </select>
            </div>
          </div>

          {busy && visible.length === 0 ? (
            <p className="hint">Loading products…</p>
          ) : visible.length === 0 ? (
            <div className="shop-empty">No products match your filters.</div>
          ) : (
            <div className="hn-grid">
              {visible.map((p) => {
                const img = primaryImage(p)
                const disc = discountPct(p)
                const mrp = mrpRate(p)
                const sale = saleRate(p)
                const qv = qtyOf(p.id)
                return (
                  <article key={p.id} className="hn-card">
                    <div className="hn-card-media">
                      {disc > 0 && <span className="hn-badge">-{disc}%</span>}
                      <button type="button" className="hn-card-img" onClick={() => openDetail(p)}>
                        {img ? <img src={img} alt={p.name || ''} /> : <span>No image</span>}
                      </button>
                    </div>
                    <button type="button" className="hn-card-name" onClick={() => openDetail(p)}>
                      {p.name}
                    </button>
                    <div className="hn-card-prices">
                      {mrp > sale && mrp > 0 && <span className="hn-mrp">{money(mrp)}</span>}
                      <span className="hn-sale">{money(sale)}</span>
                    </div>
                    <div className="hn-card-actions">
                      <div className="hn-qty">
                        <button
                          type="button"
                          onClick={() =>
                            setCardQty((prev) => ({ ...prev, [p.id]: Math.max(1, qv - 1) }))
                          }
                        >
                          −
                        </button>
                        <span>{qv}</span>
                        <button
                          type="button"
                          onClick={() => setCardQty((prev) => ({ ...prev, [p.id]: qv + 1 }))}
                        >
                          +
                        </button>
                      </div>
                      <button type="button" className="hn-add" onClick={() => addToCart(p, qv)}>
                        ADD TO CART
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {cartOpen && (
        <div className="modal-backdrop" onClick={() => setCartOpen(false)}>
          <div className="hn-cart-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="hn-cart-head">
              <h2>Your cart</h2>
              <button type="button" className="hn-link" onClick={() => setCartOpen(false)}>
                Close
              </button>
            </div>
            {cart.length === 0 ? (
              <p className="hint">Cart is empty. Select products to continue.</p>
            ) : (
              <>
                <ul className="shop-cart-list">
                  {cart.map((line) => (
                    <li key={line.product.id}>
                      <div>
                        <strong>{line.product.name}</strong>
                        <div className="hint">{money(saleRate(line.product))} each</div>
                      </div>
                      <div className="hn-qty">
                        <button
                          type="button"
                          onClick={() => setCartLineQty(line.product.id, line.qty - 1)}
                        >
                          −
                        </button>
                        <span>{line.qty}</span>
                        <button
                          type="button"
                          onClick={() => setCartLineQty(line.product.id, line.qty + 1)}
                        >
                          +
                        </button>
                      </div>
                      <div className="shop-line-total">
                        {money(saleRate(line.product) * line.qty)}
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="shop-cart-total">
                  <span>Total</span>
                  <strong>{money(cartTotal)}</strong>
                </div>
                <button
                  type="button"
                  className="hn-add hn-add-full"
                  onClick={() => {
                    setError('')
                    setCheckoutOpen(true)
                  }}
                >
                  CHECKOUT
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal shop-detail-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{detail.name}</h2>
            <div className="shop-detail-gallery">
              <div className="shop-detail-main">
                {detailImg ? (
                  <img src={detailImg} alt="" />
                ) : (
                  <div className="shop-detail-ph">No image</div>
                )}
              </div>
              <div className="shop-detail-thumbs">
                {detailImages.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    className={detailImg === img.image_url ? 'active' : ''}
                    onClick={() => setDetailImg(img.image_url)}
                  >
                    <img src={img.image_url} alt="" />
                  </button>
                ))}
              </div>
            </div>
            <div className="hn-card-prices" style={{ marginBottom: 12 }}>
              {mrpRate(detail) > saleRate(detail) && (
                <span className="hn-mrp">{money(mrpRate(detail))}</span>
              )}
              <span className="hn-sale">{money(saleRate(detail))}</span>
            </div>
            <div className="hn-qty" style={{ marginBottom: 12 }}>
              <button type="button" onClick={() => setDetailQty((n) => Math.max(1, n - 1))}>
                −
              </button>
              <span>{detailQty}</span>
              <button type="button" onClick={() => setDetailQty((n) => n + 1)}>
                +
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setDetail(null)}>
                Close
              </button>
              <button
                type="button"
                className="hn-add"
                onClick={() => {
                  addToCart(detail, detailQty)
                  setDetail(null)
                }}
              >
                ADD TO CART
              </button>
            </div>
          </div>
        </div>
      )}

      {checkoutOpen && (
        <div className="modal-backdrop" onClick={() => setCheckoutOpen(false)}>
          <div className="modal shop-checkout-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Billing &amp; place order</h2>
            <label className="settings-field">
              <span>Customer name *</span>
              <input
                className="input"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </label>
            <label className="settings-field">
              <span>Phone</span>
              <input
                className="input"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </label>
            <label className="settings-field">
              <span>Address / delivery notes</span>
              <textarea
                className="input"
                rows={3}
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
              />
            </label>
            <label className="settings-field">
              <span>Payment mode</span>
              <select
                className="input"
                value={paymentModeId}
                onChange={(e) => setPaymentModeId(e.target.value)}
              >
                {paymentModes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="shop-cart-total" style={{ marginTop: 12 }}>
              <span>Payable</span>
              <strong>{money(cartTotal)}</strong>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setCheckoutOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="hn-add"
                disabled={busy}
                onClick={() => void placeOrder()}
              >
                {busy ? 'Placing…' : 'PLACE ORDER'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
