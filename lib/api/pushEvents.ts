'use client'

const PUSH_UPDATED_EVENT = 'preventa:push-updated'

/** Notify mounted push consumers that permission/token/onboarding state changed. */
export function notifyPushChange(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PUSH_UPDATED_EVENT))
}

/** Subscribe to those notifications. Returns an unsubscribe function. */
export function subscribePushChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(PUSH_UPDATED_EVENT, handler)
  return () => window.removeEventListener(PUSH_UPDATED_EVENT, handler)
}
