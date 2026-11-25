'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useOnline } from '@/lib/useOnline'
import { dismissPushPrompt, enableBrowserPush } from '@/lib/api/push'
import { usePushState } from '@/lib/api/usePushState'

/**
 * Quiet, dismissible pre-prompt shown on authenticated screens. The native
 * permission dialog is only requested from the ENABLE ALERTS tap — browsers (and
 * WebKit in particular) ignore prompts that aren't tied to a user gesture.
 */
export default function PushOptInBanner() {
  const online = useOnline()
  const pathname = usePathname()
  const { ready, capability, promptDismissed } = usePushState()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const handleEnable = () => {
    if (busy) return
    setBusy(true)
    setMessage(null)

    void enableBrowserPush().then((result) => {
      if (!result.ok) setMessage(result.message)
      setBusy(false)
    })
  }

  const handleDismiss = () => {
    dismissPushPrompt()
  }

  // Settings has its own full notification controls — don't duplicate them there.
  if (!ready || !online || pathname === '/settings' || promptDismissed) return null

  if (capability.needsHomeScreenInstall && capability.configured) {
    return (
      <section className="panel-card mb-4 p-4" role="status" aria-label="Install app for fire alerts">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ember text-(--on-ember)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
            </span>
            <div>
              <p className="text-sm font-bold text-gray-100">Get fire alerts on this iPhone</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                Tap <span className="text-gray-300">Share → Add to Home Screen</span>, open Preventa from your Home
                Screen, then enable notifications there. Safari tabs can&apos;t receive alerts.
              </p>
            </div>
          </div>
          <button type="button" onClick={handleDismiss} className="btn-ghost btn-sm shrink-0">
            GOT IT
          </button>
        </div>
      </section>
    )
  }

  if (!capability.canRequest) return null

  return (
    <section className="panel-card mb-4 p-4" role="status" aria-label="Enable fire alerts">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ember text-(--on-ember)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.7 21a2 2 0 0 1-3.4 0" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-bold text-gray-100">Know immediately when a fire event starts</p>
            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
              Your browser will ask for permission. WARNING and CRITICAL alerts then arrive even when the app is closed.
            </p>
            {(busy || message) && (
              <p className="text-xs text-(--amber-indicator) mt-2 leading-relaxed" role={busy ? 'status' : 'alert'}>
                {busy ? 'Waiting for browser permission…' : message}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={handleEnable} disabled={busy} className="btn-primary btn-sm">
            {busy ? 'ENABLING…' : 'ENABLE ALERTS'}
          </button>
          <button type="button" onClick={handleDismiss} disabled={busy} className="btn-ghost btn-sm">
            NOT NOW
          </button>
        </div>
      </div>
    </section>
  )
}
