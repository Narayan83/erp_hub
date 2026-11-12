import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, setTokenGetter, setUnauthorizedHandler } from '../api/client'
import type { Labels, LoginResponse, MenuNode, User } from '../types'

const TOKEN_KEY = 'erp_token'
const USER_KEY = 'erp_user'
const MENUS_KEY = 'erp_menus'
const PRODUCT_KEY = 'erp_product'
const LABELS_KEY = 'erp_labels'

type AuthState = {
  token: string | null
  user: User | null
  menus: MenuNode[]
  product: string
  displayName: string
  labels: Labels
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  refreshMenus: () => Promise<void>
}

const defaultLabels: Labels = {
  party: 'Party',
  party_plural: 'Parties',
  party_code: 'Code',
  company: 'Company',
  deposit: 'Deposit',
}

const AuthContext = createContext<AuthState | null>(null)

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<User | null>(() => loadJson<User>(USER_KEY))
  const [menus, setMenus] = useState<MenuNode[]>(() => loadJson<MenuNode[]>(MENUS_KEY) ?? [])
  const [product, setProduct] = useState(() => localStorage.getItem(PRODUCT_KEY) || '')
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('erp_display') || 'ERP')
  const [labels, setLabels] = useState<Labels>(() => loadJson<Labels>(LABELS_KEY) ?? defaultLabels)

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(MENUS_KEY)
    setToken(null)
    setUser(null)
    setMenus([])
  }, [])

  setTokenGetter(() => token)
  setUnauthorizedHandler(logout)

  const refreshMenus = useCallback(async () => {
    if (!localStorage.getItem(TOKEN_KEY)) return
    const [info, nextMenus, me] = await Promise.all([
      api.get<{ product: string; display_name: string; labels: Labels }>('/auth/product'),
      api.get<MenuNode[]>('/auth/my-menus'),
      api.get<User>('/auth/me'),
    ])
    localStorage.setItem(USER_KEY, JSON.stringify(me))
    setUser(me)
    localStorage.setItem(MENUS_KEY, JSON.stringify(nextMenus ?? []))
    localStorage.setItem(PRODUCT_KEY, info.product)
    localStorage.setItem('erp_display', info.display_name)
    localStorage.setItem(LABELS_KEY, JSON.stringify(info.labels))
    setMenus(nextMenus ?? [])
    setProduct(info.product)
    setDisplayName(info.display_name)
    setLabels(info.labels ?? defaultLabels)
  }, [])

  useEffect(() => {
    document.title = displayName || "ERP"
  }, [displayName])

  useEffect(() => {
    if (!token) return
    void refreshMenus().catch(() => {
      /* keep the last login payload if the API is down */
    })
  }, [token, refreshMenus])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<LoginResponse>('/auth/login', { email, password })
    localStorage.setItem(TOKEN_KEY, res.access_token)
    localStorage.setItem(USER_KEY, JSON.stringify(res.user))
    localStorage.setItem(MENUS_KEY, JSON.stringify(res.menus ?? []))
    localStorage.setItem(PRODUCT_KEY, res.product)
    localStorage.setItem('erp_display', res.display_name)
    localStorage.setItem(LABELS_KEY, JSON.stringify(res.labels))
    setToken(res.access_token)
    setUser(res.user)
    setMenus(res.menus ?? [])
    setProduct(res.product)
    setDisplayName(res.display_name)
    setLabels(res.labels ?? defaultLabels)
  }, [])

  const value = useMemo(
    () => ({ token, user, menus, product, displayName, labels, login, logout, refreshMenus }),
    [token, user, menus, product, displayName, labels, login, logout, refreshMenus],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
