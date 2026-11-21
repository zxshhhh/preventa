/* PREVENTA PWA service worker — the single service worker for the scope.
   Doubles as the Firebase Web Push messaging worker: the page registers it as a
   module SW with the Firebase Web config injected as query params (see
   components/PwaRegister.tsx), so background FCM messages are handled here
   without a second service worker.

   Offline contract: this worker caches the app shell (all routes, chunks, fonts
   and icons) but NEVER API responses — user data lives in the app's user-scoped
   localStorage cache (lib/api/cache.ts) and is rendered from there offline. */

const CACHE = 'preventa-v3'
const PRECACHE = ['/', '/login', '/activity', '/log', '/settings', '/profile']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Per-URL adds: one failed route must not prevent the rest of the shell
      // from being cached for offline use.
      Promise.all(PRECACHE.map((path) => cache.add(path).catch(() => {}))),
    ),
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

  // RSC data requests are not app-shell assets: leave them to the browser. If
  // the network is down Next's router falls back to a full navigation, which
  // the navigate branch below serves from the cached HTML shell.
  if (url.searchParams.has('_rsc') || (req.headers.get('accept') || '').includes('text/x-component')) return

  // Query strings vary per navigation (?next=) — the shell is keyed by pathname.
  const key = url.pathname

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(url.pathname).then((cached) =>
        fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((cache) => cache.put(url.pathname, copy)).catch(() => {})
            }
            return res
          })
          .catch(() => cached || caches.match('/login')),
      ),
    )
    return
  }

  event.respondWith(
    caches.match(key).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(key, copy)).catch(() => {})
          }
          return res
        })
        // An uncached JS/CSS/image cannot be replaced by an HTML document —
        // let the browser treat it as a failed request instead.
        .catch(() => cached || Response.error())

      // Stale-while-revalidate: a cached asset is used immediately but the
      // network response still refreshes it in the background for next time.
      return cached || network
    }),
  )
})

/* Firebase Web Push (Phase 7) — wired only when the page registered this SW with
   config params; without them the SW stays a pure offline shell. Background
   fire-event alerts show a notification that opens the activity dashboard.
   Imported dynamically so an offline/cold install never fails on gstatic. */
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
  Promise.all([
    import('https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/13.3.0/firebase-messaging-sw.js'),
  ])
    .then(([{ initializeApp }, { getMessaging, onBackgroundMessage }]) => {
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
    })
    .catch(() => {
      /* Firebase modules unavailable (e.g. cold offline install) — app shell still works */
    })
}
