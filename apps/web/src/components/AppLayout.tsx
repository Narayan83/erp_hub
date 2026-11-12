import { useEffect } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { MenuOverlayProvider } from './generp/MenuOverlay'
import Sidebar from './Sidebar'

export function AppLayout() {
  const { code } = useParams()
  const { user, menus, product, displayName, logout } = useAuth()

  useEffect(() => {
    if (product === 'generp') void import('../generp.css')
    if (product === 'kramcop') void import('../kramcop/kramcop.css')
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
          <Outlet />
        </main>
      </div>
    </MenuOverlayProvider>
  )
}
