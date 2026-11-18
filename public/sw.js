/* PREVENTA PWA service worker — the single service worker for the scope.
   Doubles as the Firebase Web Push messaging worker: the page registers it as a
   module SW with the Firebase Web config injected as query params (see
   components/PwaRegister.tsx), so background FCM messages are handled here
   without a second service worker. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js'
import { getMessaging, onBackgroundMessage } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-messaging-sw.js'

const CACHE = 'preventa-v2'
const PRECACHE = ['/login', '/activity', '/']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {}),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(req).then((res) => res || caches.match('/'))),
    )
    return
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {})
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})

/* Firebase Web Push (Phase 7) — wired only when the page registered this SW with
   config params; without them the SW stays a pure offline shell. Background
   fire-event alerts show a notification that opens the activity dashboard. */
const params = new URLSearchParams(self.location.search)
const firebaseConfig = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId'].reduce(
  (cfg, key) => {
    const value = params.get(key)
    if (value) cfg[key] = value
    return cfg
  },
  {},
)

if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId) {
  const firebaseApp = initializeApp(firebaseConfig)
  const EVENT_PATH = new URL('/activity', self.location.origin)

  self.addEventListener('notificationclick', (event) => {
    const type = event.notification.data?.type
    if (type !== 'preventa_fire_event' && type !== 'preventa_test_alert') return
    event.stopImmediatePropagation()
    event.notification.close()
    event.waitUntil(self.clients.openWindow(EVENT_PATH.href))
  })

  onBackgroundMessage(getMessaging(firebaseApp), (message) => {
    const alert = message.data
    if (alert?.type !== 'preventa_fire_event' && alert?.type !== 'preventa_test_alert') return

    const notify = self.registration.showNotification(alert.title || 'PREVENTA alert', {
      body: alert.body || 'A new fire incident was reported.',
      tag: `preventa-event-${alert.event_id ?? 'unknown'}`,
      data: { type: alert.type },
    })

    const forward = self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const payload = {
          source: 'preventa-sw',
          kind: 'push',
          data: alert || {},
          notification: message.notification
            ? { title: message.notification.title, body: message.notification.body }
            : null,
        }
        for (const client of clients) client.postMessage(payload)
      })
      .catch(() => {})

    return Promise.all([notify, forward])
  })
}
