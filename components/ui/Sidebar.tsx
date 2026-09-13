'use client'

import { useEffect, useState, type ReactNode } from 'react'
import NotificationModal from '@/components/NotificationModal'
import { useSidebar } from '@/context/useSidebar'
import { useSensors } from '@/context/useSensors'
import { useHydrated } from '@/lib/useHydrated'
import { systemOnline } from '@/lib/dashboardData'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'

interface NavItem {
  href: string
  label: string
  icon: ReactNode
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/activity',
    label: 'Activity',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>
      </svg>
    ),
  },
  {
    href: '/log',
    label: 'Logs',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
]

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

function LiveStatus({ connected, title, variant }: { connected: boolean; title: string; variant: 'rail' | 'inline' }) {
  const color = connected ? 'bg-emerald-400' : 'bg-red-400'
  const label = connected ? 'ONLINE' : 'OFFLINE'
  if (variant === 'inline') {
    return (
      <div title={title} className="flex items-center gap-1.5 rounded-full border border-white/15 px-2 py-1 select-none shrink-0">
        <span className="relative flex h-2 w-2">
          <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${color} ${connected ? 'animate-ping' : ''}`} />
          <span className={`relative inline-flex rounded-full h-2 w-2 ${color}`} />
        </span>
        <span className={`text-[9px] font-extrabold tracking-widest ${connected ? 'text-emerald-400' : 'text-red-400'}`}>{label}</span>
      </div>
    )
  }
  return (
    <div title={title} className="flex flex-col items-center gap-1 select-none">
      <span className="relative flex h-2.5 w-2.5">
        <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${color} ${connected ? 'animate-ping' : ''}`} />
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
      </span>
      <span className={`text-[8px] font-extrabold tracking-widest ${connected ? 'text-emerald-400' : 'text-red-400'}`}>{label}</span>
    </div>
  )
}

export default function Sidebar() {
  const { isMobileOpen, toggle, close } = useSidebar()
  const { unreadCount } = useSensors()
  const hydrated = useHydrated()
  const pathname = usePathname()
  const router = useRouter()
  const [showNotifications, setShowNotifications] = useState(false)
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    if (!hydrated) return
    const id = setInterval(() => setNow(new Date()), 2000)
    return () => clearInterval(id)
  }, [hydrated])

  const connected = now ? systemOnline(now) : true
  const statusTitle = connected ? 'System connected to device' : 'System connection lost'

  const badge = hydrated && unreadCount > 0 && (
    <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
      {unreadCount > 9 ? '9+' : unreadCount}
    </span>
  )

  return (
    <>
      <div className="lg:hidden fixed left-4 right-4 top-4 z-50 h-14 bg-(--surface-solid) text-gray-100 rounded-2xl border border-white/10 shadow-lg flex items-center justify-between px-2">
        <button onClick={toggle} title="Menu" className="btn-icon w-10 h-10 border border-white/15 shrink-0">
          {!isMobileOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M4 6H20M4 12H20M4 18H20" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6L18 18M18 6L6 18" />
            </svg>
          )}
        </button>
        <div className="flex-1 flex justify-start ml-2">
          <div className="flex items-center bg-ember rounded-md h-9 px-2">
            <Image src="/PREVENTA-LOGO.png" loading="eager" alt="preventa" height={300} width={300} className="h-6 w-auto" />
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <LiveStatus variant="inline" connected={connected} title={statusTitle} />
          <button onClick={() => setShowNotifications(true)} title="Notifications" className="btn-icon w-10 h-10 border border-white/15 relative">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" />
              <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6981 21.5547 10.4458 21.3031 10.27 21" />
              <circle cx="17.5" cy="5.5" r="3" fill="#ef4444" stroke="none" />
            </svg>
            {badge}
          </button>
          <Link href="/profile" title="Profile" className="shrink-0">
            <Image src="/Profile-sample.png" loading="eager" alt="profile" width={40} height={40} className="rounded-full bg-white/10 w-8 h-8 cursor-pointer" />
          </Link>
        </div>
      </div>
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-black/50" onClick={close}></div>
          <aside className="fixed left-4 top-21 bottom-4 w-72 max-w-[calc(100vw-2rem)] bg-(--surface-solid) text-gray-100 z-50 flex flex-col rounded-2xl border border-white/10 shadow-lg overflow-hidden">
            <nav className="flex-1 flex flex-col p-3 gap-1 overflow-y-auto scroll-thin">
              {NAV_ITEMS.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    className={[
                      'relative flex items-center gap-3 px-3 py-3 rounded-xl transition-colors shrink-0',
                      active
                        ? 'bg-(--secondary-color)/10 text-(--secondary-color)'
                        : 'text-gray-400 hover:bg-white/5 hover:text-(--secondary-color)',
                    ].join(' ')}
                  >
                    {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-(--secondary-color)" />}
                    {item.icon}
                    <span className="text-sm font-medium">{item.label}</span>
                  </Link>
                )
              })}
            </nav>
            <div className="p-3 border-t border-white/10 shrink-0">
              <button
                onClick={() => router.push('/login')}
                title="Logout"
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-gray-400 hover:bg-white/5 hover:text-(--secondary-color)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9" />
                  <path d="M16 17L21 12L16 7" />
                  <path d="M21 12H9" />
                </svg>
                <span className="text-sm font-medium">Logout</span>
              </button>
            </div>
          </aside>
        </div>
      )}
      <aside className="hidden lg:flex fixed left-4 top-4 bottom-4 z-50 w-17 bg-(--surface-solid) text-gray-100 flex-col rounded-2xl border border-white/10 shadow-lg overflow-hidden">
        <div className="flex justify-center items-center bg-ember shrink-0 p-3">
          <Image src="/PREVENTA-LOGO.png" alt='preventa' height={300} width={300} className="w-9" />
        </div>

        <nav className="flex-1 flex flex-col gap-1 p-3 overflow-y-auto scroll-thin">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={[
                  'relative flex shrink-0 rounded-xl transition-colors justify-center py-3',
                  active
                    ? 'bg-(--secondary-color)/10 text-(--secondary-color)'
                    : 'text-gray-400 hover:bg-white/5 hover:text-(--secondary-color)',
                ].join(' ')}
              >
                {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-(--secondary-color)" />}
                {item.icon}
              </Link>
            )
          })}
        </nav>
        <div className="p-3 flex flex-col gap-2 border-t border-white/10 shrink-0">
          <LiveStatus variant="rail" connected={connected} title={statusTitle} />
          <button
            onClick={() => setShowNotifications(true)}
            title="Notifications"
            className="btn-icon w-10 h-10 border border-white/15 mx-auto relative"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" />
              <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6981 21.5547 10.4458 21.3031 10.27 21" />
            </svg> 
            {badge}
          </button>
          <Link
            href="/profile"
            title="Profile"
            className="flex justify-center py-1 rounded-xl cursor-pointer transition-colors hover:bg-white/5"
          >
            <Image src="/Profile-sample.png" alt="profile" width={40} height={40} className="rounded-full bg-white/10 w-10 h-10 shrink-0" />
          </Link>
          <button
            onClick={() => router.push('/login')}
            title="Logout"
            className="btn-icon w-10 h-10 border border-white/15 mx-auto"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9" />
              <path d="M16 17L21 12L16 7" />
              <path d="M21 12H9" />
            </svg>
          </button>
        </div>
      </aside>
      {showNotifications && (
        <NotificationModal show={showNotifications} onClose={() => setShowNotifications(false)} />
      )}
    </>
  )
}