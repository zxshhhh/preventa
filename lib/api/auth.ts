import { apiPost, getToken, setToken, getRefreshToken, setRefreshToken, signalAuthExpired } from './client'
import { ENDPOINTS } from './endpoints'
export interface AuthUser {
  username: string
}

interface LoginResponse {
  access: string
  refresh: string
}

export const USERNAME_KEY = 'preventa.username'

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function setUsername(username: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (username) localStorage.setItem(USERNAME_KEY, username)
    else localStorage.removeItem(USERNAME_KEY)
  } catch {
    /* ignore storage failures */
  }
}

/** Best-effort username claim from the access token — sessions created before the username was stored. */
function usernameFromToken(token: string): string | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
    for (const claim of ['username', 'user_name', 'preferred_username', 'email', 'name']) {
      const value = payload[claim]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  } catch {
    /* not a decodable JWT */
  }
  return null
}

/** Signed-in username: stored at login, else a token claim, else the remembered login name. */
export function getUsername(): string | null {
  const stored = readStorage(USERNAME_KEY)?.trim()
  if (stored) return stored
  const token = getToken()
  if (token) {
    const claim = usernameFromToken(token)
    if (claim) return claim
  }
  const remembered = readStorage('rememberedEmail')?.trim()
  return remembered || null
}

/** First character of the username, upper-cased, for the initial-letter avatar. */
export function initialFor(username: string | null | undefined): string {
  const trimmed = username?.trim()
  if (!trimmed) return 'U'
  return (Array.from(trimmed)[0] ?? 'U').toUpperCase()
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const trimmed = username.trim()
  const data = await apiPost<LoginResponse>(ENDPOINTS.login, { username: trimmed, password }, { authenticated: false })
  if (!data?.access || !data?.refresh) {
    throw new Error('Login failed — the server returned no token pair')
  }
  setToken(data.access)
  setRefreshToken(data.refresh)
  setUsername(trimmed)
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
  signalAuthExpired()
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
  setUsername(null)
}

export function hasToken(): boolean {
  return Boolean(getToken())
}