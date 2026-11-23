import { useEffect } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { MenuOverlayProvider } from './generp/MenuOverlay'
import Sidebar from './Sidebar'
import { HospitalShortcutBar } from '../pages/hospital/HospitalShortcutBar'
import { CorePrintPreviewHost } from '../print/CorePrintPreview'

export function AppLayout() {
  const { code } = useParams()
  const { user, menus, product, displayName, logout } = useAuth()
  const isHospital = (product || '').toLowerCase() === 'hospital'

  useEffect(() => {
    if (product === 'generp') void import('../generp.css')
    if (product === 'kramcop') void import('../kramcop/kramcop.css')
    if (product === 'contract_farming') void import('../contract_farming/contract_farming.css')
  }, [product])

  return (
    <MenuOverlayProvider currentCode={code || 'dashboard'}>
      <div className={`erp-shell product-${product || 'erp'}`}>
        <Sidebar
          theme="slate"
          user={user?.full_name || 'Admin'}
          product={product}
          displayName={displayName}
          menus={menus}
          onLogout={logout}
        />
        <main className="erp-main">
          {/* Popup shortcuts are hospital UI; print preview host is shared for any product. */}
          {isHospital ? <HospitalShortcutBar /> : null}
          <Outlet />
          <CorePrintPreviewHost />
        </main>
      </div>
    </MenuOverlayProvider>
  )
}
