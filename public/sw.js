/* PREVENTA PWA service worker — the single service worker for the scope.
   Doubles as the Firebase Web Push messaging worker: the page registers it as a
   module SW with the Firebase Web config injected as query params (see
   components/PwaRegister.tsx), so background FCM messages are handled here
   without a second service worker.

   Offline contract: this worker caches the app shell (all routes, chunks, fonts
   and icons) but NEVER API responses — user data lives in the app's user-scoped
   localStorage cache (lib/api/cache.ts) and is rendered from there offline. */

const CACHE = 'preventa-v4'
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

/* Register this BEFORE importing Firebase: the messaging SDK installs its own
   notificationclick handler and would otherwise override our deep-link logic. */
self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {}
  const type = data.type
  if (type && type !== 'preventa_fire_event' && type !== 'preventa_test_alert') return

  event.stopImmediatePropagation()
  event.notification.close()

  const fallback = new URL('/activity', self.location.origin)
  let target = fallback
  if (typeof data.url === 'string') {
    try {
      const requested = new URL(data.url, self.location.origin)
      if (requested.origin === self.location.origin) target = requested
    } catch {
      /* keep the dashboard fallback */
    }
  }

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = clients.find((client) => {
        try {
          return new URL(client.url).origin === self.location.origin
        } catch {
          return false
        }
      })
      if (existing) {
        await existing.focus()
        if ('navigate' in existing && existing.url !== target.href) {
          try {
            await existing.navigate(target.href)
          } catch {
            existing.postMessage({ source: 'preventa-sw', kind: 'navigate', url: target.href })
          }
        }
        return
      }
      await self.clients.openWindow(target.href)
    })(),
  )
})

if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId) {
  Promise.all([
    import('https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/13.3.0/firebase-messaging-sw.js'),
  ])
    .then(([{ initializeApp }, { getMessaging, onBackgroundMessage }]) => {
      const firebaseApp = initializeApp(firebaseConfig)
      const EVENT_PATH = new URL('/activity', self.location.origin)

      onBackgroundMessage(getMessaging(firebaseApp), (message) => {
        // Always show something: WebKit penalises silence and can remove the
        // subscription. Unknown payloads still get a generic PREVENTA alert.
        const alert = message.data || {}
        const type = alert.type || 'preventa_fire_event'
        const tier = Number(alert.peak_tier ?? alert.tier ?? 0)

        const notify = self.registration
          .showNotification(alert.title || 'PREVENTA alert', {
            body: alert.body || 'A new fire incident was reported.',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: `preventa-event-${alert.event_id ?? 'unknown'}`,
            data: { type, url: EVENT_PATH.href },
            // Safari 18.4+ opens this URL without needing notificationclick.
            navigate: EVENT_PATH.href,
            requireInteraction: tier >= 4,
          })
          .catch(() =>
            self.registration.showNotification('PREVENTA alert', {
              body: 'A new fire incident was reported.',
              tag: 'preventa-fallback',
              data: { type: 'preventa_fire_event', url: EVENT_PATH.href },
            }),
          )

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
      /* Firebase modules unavailable (e.g. cold offline install): keep alerts
         working with the plain Push API rather than silently dropping them. */
      self.addEventListener('push', (event) => {
        let payload = {}
        try {
          payload = event.data ? event.data.json() : {}
        } catch {
          payload = { body: event.data ? event.data.text() : '' }
        }
        const notification = payload.notification || payload
        const url = typeof notification.navigate === 'string' ? notification.navigate : '/activity'
        const title = notification.title || payload.title || 'PREVENTA alert'
        const body = notification.body || payload.body || 'A new fire incident was reported.'
        event.waitUntil(
          self.registration.showNotification(title, {
            body,
            tag: `preventa-event-${payload.event_id ?? notification.tag ?? 'unknown'}`,
            data: { type: payload.type || 'preventa_fire_event', url },
            navigate: url,
          }),
        )
      })
    })
}
