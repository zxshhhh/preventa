import { deleteToken, getMessaging, getToken, isSupported, onMessage } from "firebase/messaging"

async function updateSubscription(apiBase, accessToken, method, token) {
  const endpoint = new URL(
    `${apiBase.replace(/\/$/, "")}/notifications/push-subscription/`, location.origin,
  )
  if (endpoint.protocol !== "https:") throw new Error("PREVENTA push registration requires HTTPS.")
  const response = await fetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || `Push registration failed (${response.status}).`)
  }
}

// Call from a signed-in user's click handler. apiBase ends in /api/v1.
export async function enablePreventaPush({
  firebaseApp, serviceWorkerRegistration, vapidKey, apiBase, accessToken,
}) {
  if (!globalThis.isSecureContext || !("Notification" in globalThis)) {
    throw new Error("Web push requires a supported browser and a secure page.")
  }
  if (!vapidKey || !serviceWorkerRegistration?.active) {
    throw new Error("Web push requires a VAPID key and an active service worker.")
  }
  if (await Notification.requestPermission() !== "granted" || !(await isSupported())) {
    throw new Error("Web notifications are unavailable or permission was declined.")
  }
  const messaging = getMessaging(firebaseApp)
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration })
  if (!token) throw new Error("Firebase did not return a browser token.")
  await updateSubscription(apiBase, accessToken, "POST", token)
  return token
}

// Pass the token returned at enrollment while the owner's JWT is still valid.
export async function disablePreventaPush({ firebaseApp, apiBase, accessToken, token }) {
  if (!token) return
  await updateSubscription(apiBase, accessToken, "DELETE", token)
  await deleteToken(getMessaging(firebaseApp))
}

export function onPreventaAlert(firebaseApp, handleAlert) {
  return onMessage(getMessaging(firebaseApp), (message) => {
    const alert = message.data
    if (alert?.type === "preventa_fire_event") handleAlert(alert)
  })
}
