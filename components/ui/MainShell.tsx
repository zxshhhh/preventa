'use client'

import OfflineBanner from './OfflineBanner'
import PushOptInBanner from './PushOptInBanner'

export default function MainShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen pt-19 lg:pt-0 lg:pl-21">
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 w-full max-w-full p-4 lg:p-9"
      >
        <OfflineBanner />
        <PushOptInBanner />
        {children}
      </main>
    </div>
  )
}
