'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AUTH_EXPIRED_EVENT, TOKEN_KEY, getToken } from '@/lib/api/client'
import { getUsername, login as apiLogin, logout as apiLogout } from '@/lib/api/auth'

interface AuthContextType {
  /** False during SSR/hydration, true once localStorage has been read on mount. */
  ready: boolean
  isAuthenticated: boolean
  username: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  /** True after an explicit logout, so the guard redirects to a clean /login (no ?next). */
  isLogoutRedirect: () => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [username, setUsername] = useState<string | null>(null)
  const logoutRedirectRef = useRef(false)

  useEffect(() => {
    const syncFromStorage = () => {
      const token = getToken()
      setIsAuthenticated(Boolean(token))
      setUsername(token ? getUsername() : null)
    }

    // A failed refresh in the API client or the WS layer discards the session.
    const onExpired = () => {
      setIsAuthenticated(false)
      setUsername(null)
    }

    // Storage events fire in *other* tabs when the token is added/removed (or cleared).
    const onStorage = (event: StorageEvent) => {
      if (event.key === TOKEN_KEY || event.key === null) syncFromStorage()
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    window.addEventListener('storage', onStorage)

    // localStorage is only readable after hydration — pages are statically
    // prerendered, so defer the first read to keep the first client render
    // identical to the server HTML.
    const initId = window.setTimeout(() => {
      syncFromStorage()
      setReady(true)
    }, 0)

    return () => {
      window.clearTimeout(initId)
      window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const login = useCallback(async (user: string, password: string) => {
    await apiLogin(user, password)
    logoutRedirectRef.current = false
    setIsAuthenticated(true)
    setUsername(getUsername())
  }, [])

  const logout = useCallback(() => {
    logoutRedirectRef.current = true
    apiLogout()
    setIsAuthenticated(false)
    setUsername(null)
  }, [])

  const isLogoutRedirect = useCallback(() => logoutRedirectRef.current, [])

  const value = useMemo(
    () => ({ ready, isAuthenticated, username, login, logout, isLogoutRedirect }),
    [ready, isAuthenticated, username, login, logout, isLogoutRedirect],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
