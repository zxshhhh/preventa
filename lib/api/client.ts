import { API_BASE_URL, API_TIMEOUT_MS } from './config'

export const TOKEN_KEY = 'preventa.token'
export const REFRESH_KEY = 'preventa.refresh'

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore storage failures */
  }
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(REFRESH_KEY)
  } catch {
    return null
  }
}

export function setRefreshToken(token: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token)
    else localStorage.removeItem(REFRESH_KEY)
  } catch {
    /* ignore storage failures */
  }
}

interface RequestOptions {
  authenticated?: boolean
  headers?: Record<string, string>
  timeout?: number
  _retry?: boolean
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function extractErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'Unknown error'

  const obj = payload as Record<string, unknown>

  if (typeof obj.detail === 'string') return obj.detail
  if (Array.isArray(obj.detail)) return obj.detail.join(', ')

  for (const key of Object.keys(obj)) {
    const val = obj[key]
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') {
      return `${key}: ${val[0]}`
    }
  }

  if (typeof obj.message === 'string') return obj.message

  return 'Request failed'
}

let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise

  const refresh = getRefreshToken()
  if (!refresh) return null

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      })
      if (!res.ok) throw new Error('Refresh failed')
      const data = await res.json()
      const access = data.access
      if (access) setToken(access)
      return access
    } catch {
      setToken(null)
      setRefreshToken(null)
      return null
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

async function request<T>(path: string, init: RequestInit, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeout ?? API_TIMEOUT_MS)

  const headers = new Headers(options.headers)
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (options.authenticated !== false) {
    const token = getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(`Request timed out after ${options.timeout ?? API_TIMEOUT_MS}ms`, 0)
    }
    throw new ApiError('Network error — could not reach the API', 0)
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  const payload = text ? safeParse(text) : undefined

  if (!response.ok) {
    if (response.status === 401 && options.authenticated !== false && !options._retry) {
      const newToken = await refreshAccessToken()
      if (newToken) {
        const retryHeaders = new Headers(headers)
        retryHeaders.set('Authorization', `Bearer ${newToken}`)
        return request<T>(path, { ...init, headers: retryHeaders }, { ...options, _retry: true })
      }
    }

    const message = extractErrorMessage(payload)
    throw new ApiError(message, response.status)
  }

  return payload as T
}

export function apiGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>(path, { method: 'GET' }, options)
}

export function apiPost<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }, options)
}

export function apiPut<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }, options)
}

export function apiPatch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }, options)
}

/** DELETE with an optional JSON body (e.g. {token} for push-subscription opt-out). */
export function apiDelete<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>(path, { method: 'DELETE', body: body === undefined ? undefined : JSON.stringify(body) }, options)
}

/** Authenticated binary fetch (e.g. capture images) — returns a Blob, never parsed as JSON. */
export async function apiBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  async function attempt(authToken: string | null): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeout ?? API_TIMEOUT_MS)
    const headers = new Headers(options.headers)
    if (authToken) headers.set('Authorization', `Bearer ${authToken}`)
    try {
      return await fetch(`${API_BASE_URL}${path}`, { method: 'GET', headers, signal: controller.signal })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ApiError(`Request timed out after ${options.timeout ?? API_TIMEOUT_MS}ms`, 0)
      }
      throw new ApiError('Network error — could not reach the API', 0)
    } finally {
      clearTimeout(timer)
    }
  }

  const token = options.authenticated === false ? null : getToken()
  let response = await attempt(token)

  if (response.status === 401 && options.authenticated !== false && !options._retry) {
    const newToken = await refreshAccessToken()
    if (newToken) {
      options = { ...options, _retry: true }
      response = await attempt(newToken)
    }
  }

  if (!response.ok) {
    throw new ApiError(`Image request failed (${response.status})`, response.status)
  }
  return response.blob()
}