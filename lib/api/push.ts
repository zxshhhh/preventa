import { apiPost, apiDelete, ApiError } from './client'
import { ENDPOINTS } from './endpoints'

// Firebase Web push (Phase 7). Config arrives from the backend teammate via env:
// NEXT_PUBLIC_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / MESSAGING_SENDER_ID / APP_ID + NEXT_PUBLIC_FIREBASE_VAPID_KEY.
// Architecture: the PWA service worker (public/sw.js) doubles as the FCM messaging
// worker — PwaRegister registers it as a module SW with the config as query params,
// and getToken targets that same registration. firebase/* is only loaded dynamically
// inside functions, so the bundle stays clean when push is unconfigured.
// Backend contract: FCM data messages carry type === 'preventa_fire_event' with
// event_id / title / body; the background SW shows a notification that opens /activity.

const PUSH_TOKEN_KEY = 'preventa.pushToken'

interface FirebaseWebConfig {
  apiKey: string
  authDomain: string
  projectId: string
  messagingSenderId: string
  appId: string
}

export function getFirebaseConfig(): FirebaseWebConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim()
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()
  const senderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim()
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim()
  if (!apiKey || !projectId || !senderId || !appId) return null
  return {
    apiKey,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() || `${projectId}.firebaseapp.com`,
    projectId,
    messagingSenderId: senderId,
    appId,
  }
}

export function getVapidKey(): string | null {
  return process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY?.trim() || null
}

/** True only when both the public Web config and the VAPID key are present. */
export function isPushConfigured(): boolean {
  return getFirebaseConfig() !== null && getVapidKey() !== null
}

export function getStoredPushToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(PUSH_TOKEN_KEY)
  } catch {
    return null
  }
}

function setStoredPushToken(token: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (token) localStorage.setItem(PUSH_TOKEN_KEY, token)
    else localStorage.removeItem(PUSH_TOKEN_KEY)
  } catch {
    /* ignore storage failures */
  }
}

async function loadFirebaseMessaging() {
  const [appMod, messagingMod] = await Promise.all([import('firebase/app'), import('firebase/messaging')])
  const initializeApp = appMod.initializeApp
  const getApp = appMod.getApp
  const getApps = appMod.getApps
  return {
    getMessaging: messagingMod.getMessaging,
    isSupported: messagingMod.isSupported,
    onMessage: messagingMod.onMessage,
    getToken: messagingMod.getToken,
    deleteToken: messagingMod.deleteToken,
    ensureApp: (config: FirebaseWebConfig) => (getApps().length ? getApp() : initializeApp(config)),
  }
}

export type PushEnableResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'unsupported' | 'denied' | 'conflict' | 'error'; message: string }

/**
 * Enable browser notifications: permission → the PWA service worker (already the
 * Firebase messaging worker) → FCM token → POST /notifications/push-subscription/
 * with {token} (201 and 204 are both successful).
 */
export async function enableBrowserPush(): Promise<PushEnableResult> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !window.isSecureContext ||
    !('Notification' in window)
  ) {
    return { ok: false, reason: 'unsupported', message: 'Push is unavailable on this browser.' }
  }
  const config = getFirebaseConfig()
  const vapidKey = getVapidKey()
  if (!config || !vapidKey) {
    return {
      ok: false,
      reason: 'error',
      message: 'Push is not configured yet — the backend teammate still needs to send the Firebase Web config and VAPID key.',
    }
  }

  let permission: NotificationPermission | 'unsupported'
  try {
    permission = await Notification.requestPermission()
  } catch {
    permission = 'unsupported'
  }
  if (permission !== 'granted') {
    return {
      ok: false,
      reason: 'denied',
      message:
        permission === 'denied'
          ? 'Notifications are blocked for this site. Enable them in the browser’s site settings, then try again.'
          : 'Push is unavailable on this browser.',
    }
  }

  try {
    // The PWA service worker doubles as the Firebase messaging worker (PwaRegister
    // registered it with config params on every page); reuse it instead of a second SW.
    const registration = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.ready)

    const fb = await loadFirebaseMessaging()
    const supported = await fb.isSupported().catch(() => false)
    if (!supported) {
      return { ok: false, reason: 'unsupported', message: 'Push is unavailable on this browser.' }
    }

    const app = fb.ensureApp(config)
    const messaging = fb.getMessaging(app)
    const token = await fb.getToken(messaging, { vapidKey, serviceWorkerRegistration: registration })
    if (!token) {
      return { ok: false, reason: 'error', message: 'Could not register this browser for push — no token was returned.' }
    }

    try {
      await apiPost(ENDPOINTS.pushSubscription, { token })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        return {
          ok: false,
          reason: 'conflict',
          message: 'This browser’s subscription is linked to another account. Unregister it from that account first, then retry.',
        }
      }
      throw err
    }

    setStoredPushToken(token)
    return { ok: true, token }
  } catch {
    return { ok: false, reason: 'error', message: 'Enabling browser notifications failed — please try again.' }
  }
}

/**
 * Disable browser notifications: DELETE /notifications/push-subscription/ with {token},
 * then remove the Firebase token. The API returns 204. A failed unsubscribe is reported
 * accurately so the user can retry.
 */
export async function disableBrowserPush(accessTokenOverride?: string | null): Promise<{ ok: boolean; message?: string }> {
  const token = getStoredPushToken()
  const config = getFirebaseConfig()

  if (token) {
    try {
      // The override keeps the DELETE authenticated when called just before logout clears the JWT.
      await apiDelete(
        ENDPOINTS.pushSubscription,
        { token },
        accessTokenOverride ? { headers: { Authorization: `Bearer ${accessTokenOverride}` } } : {},
      )
    } catch {
      return { ok: false, message: 'Unsubscribe failed on the server — your changes were not saved. Please retry.' }
    }
  }

  if (config) {
    try {
      const fb = await loadFirebaseMessaging()
      const app = fb.ensureApp(config)
      const messaging = fb.getMessaging(app)
      await fb.deleteToken(messaging)
    } catch {
      /* the server opt-out already succeeded; a local cleanup failure is not user-visible */
    }
  }

  setStoredPushToken(null)
  return { ok: true }
}

export interface PushAlert {
  eventId: string | null
  title: string
  body: string
  level: 'WARNING' | 'CRITICAL' | null
}

/**
 * Foreground listener: renders incoming FCM messages as an in-app alert and refreshes history.
 * Returns an unsubscribe function; call it when the owner session ends. `event_id` is the
 * incident identifier.
 */
export async function onForegroundPush(handler: (alert: PushAlert) => void): Promise<() => void> {
  if (typeof window === 'undefined') return () => {}
  const config = getFirebaseConfig()
  if (!config) return () => {}

  try {
    const fb = await loadFirebaseMessaging()
    const supported = await fb.isSupported().catch(() => false)
    if (!supported) return () => {}

    const app = fb.ensureApp(config)
    const messaging = fb.getMessaging(app)
    return fb.onMessage(messaging, (payload) => {
      const data = (payload.data ?? {}) as Record<string, string>
      // Backend contract: fire-event pushes carry type === 'preventa_fire_event';
      // ignore anything else (missing type is tolerated defensively).
      if (data.type && data.type !== 'preventa_fire_event' &&
  data.type !== 'preventa_test_alert') return
      const tier = Number(data.peak_tier ?? data.tier ?? 0)
      handler({
        eventId: data.event_id ?? null,
        title: data.title || payload.notification?.title || 'PREVENTA alert',
        body: data.body || payload.notification?.body || 'A new fire incident was reported.',
        level: tier >= 4 ? 'CRITICAL' : tier >= 3 ? 'WARNING' : null,
      })
    })
  } catch {
    return () => {}
  }
}

/** Runs before the signed-in JWT is cleared on logout, per the contract. Fire-and-forget safe. */
export async function unsubscribePushBeforeLogout(accessToken: string | null): Promise<void> {
  if (!getStoredPushToken()) return
  try {
    await disableBrowserPush(accessToken)
  } catch {
    /* a failed unsubscribe keeps the token so the user can retry after signing back in */
  }
}
