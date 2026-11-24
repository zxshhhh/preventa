/**
 * Stable per-user scope shared by the JSON API cache and the capture-blob cache.
 * Username is set at login and survives token refresh.
 */
export function getCacheScope(): string {
  if (typeof window === 'undefined') return 'anon'
  try {
    const username = localStorage.getItem('preventa.username')?.trim()
    if (username) return `u:${username.toLowerCase()}`
    const token = localStorage.getItem('preventa.token')
    if (token) {
      // Legacy sessions without a stored username: a compact deterministic hash
      // keeps persisted entries from mixing users without storing the JWT itself.
      let h = 2166136261
      for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i)
        h = Math.imul(h, 16777619)
      }
      return `t:${(h >>> 0).toString(36)}`
    }
  } catch {
    /* storage unavailable */
  }
  return 'anon'
}
