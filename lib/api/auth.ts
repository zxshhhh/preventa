import { apiPost, getToken, setToken, getRefreshToken, setRefreshToken } from './client'
import { ENDPOINTS } from './endpoints'
export interface AuthUser {
  username: string
}

interface LoginResponse {
  access: string
  refresh: string
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const trimmed = username.trim()
  const data = await apiPost<LoginResponse>(ENDPOINTS.login, { username: trimmed, password }, { authenticated: false })
  if (!data?.access || !data?.refresh) {
    throw new Error('Login failed — the server returned no token pair')
  }
  setToken(data.access)
  setRefreshToken(data.refresh)
  return { username: trimmed }
}

export async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefreshToken()
  if (!refresh) return null

  try {
    const data = await apiPost<{ access: string }>(ENDPOINTS.refresh, { refresh }, { authenticated: false })
    if (data?.access) {
      setToken(data.access)
      return data.access
    }
  } catch {
    /* refresh failed */
  }
  setToken(null)
  setRefreshToken(null)
  return null
}

export function logout(): void {
  // Contract: unsubscribe push BEFORE clearing the signed-in JWT (fire-and-forget —
  // logout must stay synchronous; a failed unsubscribe keeps the token for retry).
  const accessToken = getToken()
  void import('./push')
    .then((m) => m.unsubscribePushBeforeLogout(accessToken))
    .catch(() => {})
  setToken(null)
  setRefreshToken(null)
}

export function hasToken(): boolean {
  return Boolean(getToken())
}