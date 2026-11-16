export const API_BASE_URL: string = (process.env.NEXT_PUBLIC_API_URL ?? '')
  .trim()
  .replace(/\/+$/, '')

export const API_TIMEOUT_MS = 15_000

export function isApiConfigured(): boolean {
  return API_BASE_URL.length > 0
}

export function getWebSocketUrl(): string {
  const base = API_BASE_URL.replace(/^http/i, 'ws')
  return `${base.replace(/\/+$/, '')}/ws/live/`
}