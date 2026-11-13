import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { AppLayout } from './components/AppLayout'
import { useEnterMovesNextField } from './hooks/useEnterMovesNextField'
import { useGlobalSaveShortcut } from './hooks/useGlobalSaveShortcut'
import { LoginPage } from './pages/LoginPage'
import { renderMenuPage } from './menuPages'

function Protected({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  if (!token) return <Navigate to="/login" replace />
  return children
}

function MenuRoute() {
  const { code } = useParams()
  const { product } = useAuth()
  return <>{renderMenuPage(code || 'dashboard', product)}</>
}

function GlobalShortcuts() {
  useGlobalSaveShortcut()
  useEnterMovesNextField()
  return null
}

export default function App() {
  return (
    <>
      <GlobalShortcuts />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <Protected>
              <AppLayout />
            </Protected>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path=":code" element={<MenuRoute />} />
        </Route>
      </Routes>
    </>
  )
}
