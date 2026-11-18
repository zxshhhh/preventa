'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/context/useAuth'

/**
 * Client-side route guard. Server redirect()/middleware cannot be used here:
 * the JWT lives in localStorage (invisible to the server) and a redirect()
 * thrown in a server component loops under the vinext CDN adapter.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { ready, isAuthenticated, isLogoutRedirect } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (ready && !isAuthenticated) {
      // `replace` keeps the login page out of history so Back cannot bounce
      // between the protected route and the redirect. An explicit logout skips
      // the deep-link param so the user does not return to that page by accident.
      const target = isLogoutRedirect() ? '/login' : `/login?next=${encodeURIComponent(pathname)}`
      router.replace(target)
    }
  }, [ready, isAuthenticated, isLogoutRedirect, pathname, router])

  // Identical on server and client's first render — no protected-content flash
  // and no hydration mismatch while the session check is pending.
  if (ready && isAuthenticated) return <>{children}</>

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      role="status"
      aria-live="polite"
      aria-label="Checking session"
    >
      <div className="flex flex-col items-center gap-3">
        <div
          aria-hidden="true"
          className="h-9 w-9 rounded-full border-2 border-white/15 border-t-(--secondary-color) animate-spin"
        />
        <span className="text-xs font-semibold tracking-widest text-gray-500 uppercase">Checking session…</span>
      </div>
    </div>
  )
}
