'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { getPushCapability, getPushOnboarding, resyncBrowserPush, type PushCapability, type PushOnboardingState } from './push'
import { subscribePushChange } from './pushEvents'

const PUSH_DISMISS_MS = 7 * 24 * 60 * 60 * 1000

export interface PushState {
  ready: boolean
  capability: PushCapability
  onboarding: PushOnboardingState
  /** Cooldown computed outside render so the banner stays a pure component. */
  promptDismissed: boolean
}

/* Server and first client render must match: the real browser state is only
   resolved after mount (see hydratePushState) to avoid hydration mismatches. */
const SERVER_CAPABILITY: PushCapability = {
  configured: false,
  supported: false,
  permission: 'unsupported',
  needsHomeScreenInstall: false,
  canRequest: false,
  enabled: false,
}
const SERVER_STATE: PushState = {
  ready: false,
  capability: SERVER_CAPABILITY,
  onboarding: {},
  promptDismissed: false,
}

let currentState: PushState = SERVER_STATE
let hydrated = false
let attached = false
let pollTimer: ReturnType<typeof setTimeout> | null = null
let resyncInFlight = false
let lastResyncAt = 0
const listeners = new Set<() => void>()

function sameCapability(a: PushCapability, b: PushCapability): boolean {
  return (
    a.configured === b.configured &&
    a.supported === b.supported &&
    a.permission === b.permission &&
    a.needsHomeScreenInstall === b.needsHomeScreenInstall &&
    a.canRequest === b.canRequest &&
    a.enabled === b.enabled
  )
}

function sameOnboarding(a: PushOnboardingState, b: PushOnboardingState): boolean {
  return (
    a.promptedAt === b.promptedAt &&
    a.dismissedAt === b.dismissedAt &&
    a.lastPermission === b.lastPermission
  )
}

function sameState(a: PushState, b: PushState): boolean {
  return (
    a.ready === b.ready &&
    a.promptDismissed === b.promptDismissed &&
    sameCapability(a.capability, b.capability) &&
    sameOnboarding(a.onboarding, b.onboarding)
  )
}

async function runResync(force = false): Promise<void> {
  if (!hydrated || resyncInFlight) return
  if (!force && Date.now() - lastResyncAt < 60_000) return
  lastResyncAt = Date.now()
  resyncInFlight = true
  try {
    await resyncBrowserPush()
  } finally {
    resyncInFlight = false
  }
}

function setState(next: PushState): void {
  const previous = currentState
  if (sameState(previous, next)) return
  currentState = next
  for (const listener of listeners) listener()

  // WebKit can drop iOS subscriptions silently. A transition into granted (or
  // the initial hydrate with an already-granted permission) re-upserts the token.
  if (hydrated && previous.capability.permission !== 'granted' && next.capability.permission === 'granted') {
    void runResync(true)
  }
}

function recompute(): void {
  if (!hydrated) return
  const onboarding = getPushOnboarding()
  const dismissedAt = onboarding.dismissedAt
  setState({
    ready: true,
    capability: getPushCapability(),
    onboarding,
    promptDismissed: Boolean(dismissedAt && Date.now() - dismissedAt < PUSH_DISMISS_MS),
  })
}

/** Public refresh hook for consumers that need to force a re-read. */
export function refreshPushState(): void {
  recompute()
}

function schedulePoll(): void {
  if (pollTimer !== null) clearTimeout(pollTimer)
  const delay = currentState.capability.permission === 'default' ? 3000 : 10_000
  pollTimer = setTimeout(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') recompute()
    schedulePoll()
  }, delay)
}

function attachGlobalListeners(): void {
  if (attached || typeof window === 'undefined') return
  attached = true

  subscribePushChange(recompute)
  window.addEventListener('storage', recompute)
  window.addEventListener('focus', recompute)
  // BFCache restores don't always fire focus/visibilitychange.
  window.addEventListener('pageshow', () => {
    recompute()
    void runResync()
  })
  window.addEventListener('online', () => {
    recompute()
    void runResync()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    recompute()
    void runResync()
  })

  // Chromium/Firefox expose a change event; Safari/iOS usually don't, so the
  // poll above is the fallback that catches permissions changed in site settings.
  if ('permissions' in navigator) {
    void navigator.permissions
      .query({ name: 'notifications' } as PermissionDescriptor)
      .then((status) => {
        status.addEventListener('change', recompute)
      })
      .catch(() => {})
  }

  schedulePoll()
}

function hydratePushState(): void {
  if (hydrated || typeof window === 'undefined') return
  hydrated = true
  attachGlobalListeners()
  recompute()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): PushState {
  return currentState
}

function getServerSnapshot(): PushState {
  return SERVER_STATE
}

/** Shared, reactive push permission/token/onboarding state. */
export function usePushState(): PushState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  useEffect(() => {
    hydratePushState()
  }, [])
  return state
}
