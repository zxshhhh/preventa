/* PREVENTA Firebase messaging service worker (Phase 8 — browser push).
   Config arrives via query params from lib/api/push.ts so this file stays static.
   Kept separate from public/sw.js: the app-shell SW never caches captures or API responses. */

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js')

var params = new URLSearchParams(self.location.search)
var config = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
}

try {
  firebase.initializeApp(config)
  var messaging = firebase.messaging()

  messaging.onBackgroundMessage(function (payload) {
    var data = payload.data || {}
    var title = data.title || (payload.notification && payload.notification.title) || 'PREVENTA alert'
    var body = data.body || (payload.notification && payload.notification.body) || 'A new fire incident was reported.'
    self.registration.showNotification(title, {
      body: body,
      tag: 'preventa-event-' + (data.event_id || 'generic'),
      data: { historyPath: data.history_path || '/activity' },
    })
  })

  // Background notification opens the Fire Event History page.
  self.addEventListener('notificationclick', function (event) {
    event.notification.close()
    var target = (event.notification.data && event.notification.data.historyPath) || '/activity'
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i]
          if ('focus' in client) return client.focus()
        }
        return self.clients.openWindow(target)
      }),
    )
  })
} catch {
  /* Firebase push is not configured for this origin — the SW stays inert. */
}
