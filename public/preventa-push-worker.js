import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw"

// Call once from the PWA's bundled service worker entry using its Firebase app.
export function enablePreventaPushWorker(firebaseApp, eventPath = "/") {
  const page = new URL(eventPath, self.location.origin)
  if (page.origin !== self.location.origin) throw new Error("Use a same-origin event history path.")

  self.addEventListener("notificationclick", (event) => {
    if (event.notification.data?.type !== "preventa_fire_event") return
    event.stopImmediatePropagation()
    event.notification.close()
    event.waitUntil(self.clients.openWindow(page.href))
  })

  onBackgroundMessage(getMessaging(firebaseApp), (message) => {
    const alert = message.data
    if (alert?.type !== "preventa_fire_event") return
    return self.registration.showNotification(alert.title, {
      body: alert.body,
      tag: `preventa-event-${alert.event_id}`,
      data: { type: alert.type },
    })
  })
}