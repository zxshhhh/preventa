# PREVENTA FRONTEND TASKS

## Frontend Implementation Handoff — Next.js Codebase Edition

> **Updated:** This edition reflects the actual **Next.js 16 + React 19 + Tailwind CSS v4** codebase (the Nuxt build was ported). Deployment target is **Cloudflare Workers** via vinext. API contracts below are unchanged and authoritative.

> **Start with the owner workflow** — Sign in, select a residence and device, update the SMS contact, confirm device sync, then open Fire Event History. Finish those flows before connecting Firebase. Contact edits and incident history work independently of browser push.

## Implementation order (status in this codebase)

| Task | Build | Where it lives now | Status |
|---|---|---|---|
| 1 ✅ Shared API client | Session handling, owner-scoped queries, device selector and standard loading, stale and error states. | `lib/api/` (`config.ts`, `client.ts`, `endpoints.ts` + domain modules) | **Done** |
| 2 ✅ Emergency contacts | List, add, edit, reorder and remove residence contacts. Show which contact receives SMS and whether each board has synced. | `lib/api/profile.ts` + `components/ProfileContent.tsx` | **Done** (PATCH/DELETE wired, priority picker, active-recipient display) |
| 3 ✅ Device settings | Edit advisory thresholds, cloud reporting and camera enablement. Show saved, pending and applied states separately. | `lib/api/settings.ts` + `components/SettingsContent.tsx` | **Done** (thresholds + reporting interval + camera toggle sync; pending/applied polling implemented) |
| 4 ✅ Fire event history | List incidents, filter by device or status, and refresh based on new activity. | `lib/api/events.ts`, `lib/api/reports.ts` + `components/LogConsole.tsx`, `LogMonthModal.tsx`, `LogDetailModal.tsx` | **Done** (device + status filter chips kept, but the 12 month cards **always render** — month skeleton from an unfiltered `fetchLogs()`, so chips never collapse the grid; focus/online/tier-transition refresh; distinct error state) |
| 5 ✅ Browser push | Add a notification settings control, foreground alert and background service-worker handler. | Existing fallback: `context/useSensors.tsx` → `new Notification()` → `ServiceWorkerRegistration.showNotification()` (public/sw.js) → in-app toast | **Scaffolded** — full contract implemented in `lib/api/push.ts` (`enableBrowserPush` / `disableBrowserPush` / `onForegroundPush` wired into `useSensors`; `public/firebase-messaging-sw.js` background handler; Settings enable/disable section). Waits on the Firebase Web config + VAPID key env vars from the backend teammate |
| 6 ✅ Existing screens | Finish live readings, trends, baselines, camera gallery, residence and device management, and notification activity where needed. | `/activity` (`DashboardContent`, `useSensors`), `NotificationModal`, `LogDetailModal` | **Done** — baselines ("Calibration Status" in Settings), residence CRUD (Profile "Residences" card), device register/delete (Settings "Device Management" card, one-time `api_key` reveal), notification activity (`GET /notifications/` DELIVERY ACTIVITY section in NotificationModal) all landed |

---

## Shared API and session handling

- **Implemented in `lib/api/`.** `config.ts` reads `NEXT_PUBLIC_API_URL` from `.env.local` (base URL only, e.g. `http://localhost:8000`, no trailing slash). All endpoint paths in `endpoints.ts` carry the `/api/v1/` prefix. For the deployed API use base `https://preventa.duckdns.org`; the app is API-only — no mock data.
- `client.ts` is the `fetch` wrapper (`apiGet/apiPost/apiPut/apiPatch/apiDelete`): 15 s timeout, JSON parse, `ApiError` normalization with DRF error extraction (`detail`, field errors). `Authorization: Bearer <access>` is sent from `localStorage['preventa.token']` (skipped for login). **Auto-refresh on 401**: calls `refreshAccessToken()` once and retries the request.
- Sign in uses `POST /auth/login/` with `{username, password}` (username, not email) → returns `{access, refresh}`, both stored by `lib/api/auth.ts`. Session-expiry/refresh handling matches the contract above: on refresh failure the user is returned to sign-in. `logout()` clears tokens locally (no server call).
- `GET /residences/` and `GET /devices/` — list endpoints return `count`, `next`, `previous`, `results`. Preserve filters when paging, refresh after writes, and clear owner data when switching accounts.
- Field errors map to form inputs, unsaved edits are kept on failure, and transient errors show a retry. Missing resources, sessions and throttling are handled separately from an empty list. Personal data and authenticated API responses stay out of the PWA offline cache (service worker `public/sw.js` only precaches the app shell: `/login`, `/activity`, `/`).
- **Live channel:** `lib/api/realtime.ts` `connectLiveTelemetry(token, onReading, onClose)` opens the WebSocket to `ws(s)://<host>/ws/live/?token=<access>` (scheme derived in `config.ts`). `context/useSensors.tsx` reconnects on close and refreshes the token on a 4401 close code, with REST backfill from `fetchLatestSeries` every 30 s.
- **Route gating:** the Cloudflare CDN adapter forbids `redirect()` inside server components (redirect-loop), so `/` → `/login` lives in `next.config.ts` `redirects()` and any further owner gating is client-side.

> **Note:** After PWA deployment, send the exact browser origin (the Workers `*.workers.dev` URL / custom domain) to the backend teammate for the CORS allowlist. Restart `npm run dev` after changing `.env.local`.

---

## Emergency contacts and settings

### Update the SMS recipient

**Implemented via `lib/api/profile.ts`** — contacts are scoped to the first residence (`GET /residences/` then `/residences/<id>/contacts/`), surfaced in `components/ProfileContent.tsx` with live name, avatar and working contact CRUD; saves confirm through a `pushToast` from `useSensors()`.

| Request | Frontend behavior |
|---|---|
| `GET /residences/{residencePk}/contacts/` | Show this residence's contacts with name, phone and priority. Priority 1 is first. The lowest numeric priority wins among valid numbers, with the lowest contact ID breaking ties. |
| `POST /residences/{residencePk}/contacts/` | Create with name (up to 100 characters), phone, and integer priority (1 to 5). Accept Philippine mobile or international format. Display the normalized number from the server response. |
| `PATCH /contacts/{id}/` | Save the changed fields only, such as `{"phone":"09170000000"}`. Use the contact ID returned by the list. If the user changes priority, refresh the active recipient display. |
| `DELETE /contacts/{id}/` | Confirm removal and reload contacts and associated device details. Removing the last valid contact disables automatic SMS after sync. |

### Device settings

**Implemented via `lib/api/settings.ts`** — `fetchCalibration()`/`saveCalibration()` use `GET|PATCH /devices/<id>/update/`; the form lives in `components/SettingsContent.tsx` and is cached in `localStorage` key `preventa.calibration` (loaded post-hydration). WARNING thresholds sync to the device; NOMINAL thresholds stay local.

`GET /devices/{pk}/` returns the current saved settings and sync status. Send edited fields to `PATCH /devices/{pk}/update/`. Use the device's numeric id for both URLs. An example save is `{"temperature_threshold":35,"sample_interval_sec":10,"camera_enabled":false}`.

| Field | UI label | Accepted value |
|---|---|---|
| `temperature_threshold` | Temperature advisory | 1 to 38 °C |
| `ppm_threshold` | CO proxy advisory | 1 to 50 proxy units |
| `humidity_threshold` | Humidity advisory | 1 to 100 %RH |
| `current_threshold` | Current advisory | 0.1 to 8 A |
| `sample_interval_sec` | Cloud reporting interval | 2 to 60 whole seconds |
| `camera_enabled` | Camera enabled | Boolean |

Use `null` to restore a numeric setting to its firmware default. Explain that the reporting interval controls routine uploads and that local acquisition stays on its nominal two-second schedule.

**Saved versus applied** — After a contact or device change, refetch device detail. While `config_pending` is `true`, show "Saved, awaiting device sync" and poll periodically while the screen is open. When `false`, show "Applied" with `config_applied_at`. If the fields are absent, show "Sync status unavailable." A single residence can have multiple devices and their statuses may differ. Device application does not confirm SMS receipt.

---

## Fire event history and live readings

### Fire Event History screen

**Implemented via `lib/api/events.ts` / `reports.ts` + `LogConsole` / `LogMonthModal` / `LogDetailModal`** — 12 month cards with mini calendars, month modal listing warning/critical events, and a detail modal showing the four sensor readings plus an ESP32-CAM snapshot.

Fetch `GET /events/`, newest incident first. Offer an optional device filter `?device_id=<hardware-id>` and a status filter `active`, `resolved`, or `false_alarm`. Render incident start and end time, duration, peak tier, peak type and device name or ID. Show "Ongoing" when `end_time` is `null`. Use a readable status label and icon alongside color.

| Detail | Implementation |
|---|---|
| Device identity | The filter takes the string `device_id` from `GET /devices/`. Each event's response field named `device_id` is the numeric device id. Join against the device list and use the same distinction for readings and captures. |
| Event lifecycle | The backend opens an incident on an accepted Tier 3+ reading. It tracks peak tier and type and resolves the incident at the first accepted reading below Tier 3. Use the returned event id as the row key. In this codebase, `level` maps from `peak_tier`: 4→CRITICAL, 3→WARNING. |
| Event details | Open details from the event row already returned by the list. Present read-only history for owners and leave incident lifecycle writes to the device API. |
| Refreshing history | Refresh on screen focus, after reconnect, or when active-device readings indicate a tier transition. Debounce refreshes and keep paging predictable. The live channel carries readings; incident lists come from REST. `useSensors` polls `/events/` every 5 s into the notification history (deduped by `id`, newest-first, capped at 50, persisted to `localStorage` key `preventa.notifications.v2`). |

### Dashboard and trends

**Implemented via `/activity` (`DashboardContent` + `DashboardMetricCard`)** — Gas / Temperature / Humidity / Power cards with live value + delta, hover trend chart and threshold bar; shared `1H`/`24H`/`7D`/`30D` switcher (`1H` charts the live WS buffer, longer ranges use `fetchRangeSeries` and refresh every 60 s while the KPI value stays live).

- `lib/api/telemetry.ts` fetches `GET /readings/?device_id=<hardware-id>` for initial state and reconnect recovery (`fetchLatestSeries`; `fetchRangeSeries` for 24H/7D/30D with ISO 8601 `start`/`end`, sampling up to 40 pages evenly for long windows). Display `smooth_temperature`, `smooth_humidity`, `smooth_current`, `smooth_ppm` as a CO proxy, and the actual `final_tier` and `tier_name`.
- WebSocket per the contract above; `useSensors` filters `payload.device` against the selected device, merges by reading ID, and refetches REST after reconnect. Refresh the token when needed.
- Show last reading time and a reconnecting or stale state. Use `last_heartbeat` and reading age relative to the configured reporting interval. Treat missing sensor fields as unavailable. An open socket or an old "online" badge alone cannot establish the board is reporting now — the sidebar `LiveStatus` dot polls `GET /api/v1/devices/` every 10 s (`lib/api/system.ts`, online if any device is `status === 'online'`).
- Show `relay_cut`, `siren`, and `cam_active` as last-reported states. Keep stale values visibly marked. The existing relay controls are on the local setup portal.

> **Code contracts.** `api/urls.py`, `api/views.py`, `api/serializers.py`, `api/events.py`, `api/consumers.py`, and `api/routing.py`.

---

## Browser push notifications

### Before integration

Get the Firebase public Web config and public VAPID key from the backend teammate. Use the same Firebase project as the sender. Serve both the PWA and API over HTTPS (**already satisfied** — the Workers deploy is HTTPS; local dev is `localhost`). The backend teammate owns the private Firebase credential, migration and running sender.

> **Current fallback layer (implemented):** `useSensors` fires alerts through a layered browser-notification fallback — `new Notification()` → `ServiceWorkerRegistration.showNotification()` via `public/sw.js` (registered by `components/PwaRegister.tsx`, mounted in the root layout) → silent fallback to in-app toast. This avoids `Illegal constructor` on iOS/Safari. Firebase push is **not** wired yet; the steps below describe the remaining work, adapted from Nuxt to this codebase.

### Wire the existing helpers into Next.js

1. Run `npm install firebase`. Copy `pwa_integration/preventa-push.js` and `pwa_integration/preventa-push-worker.js` from the backend workspace. Initialize Firebase from the public config in browser code and in the bundled worker entry. Under vinext, the worker entry is bundled separately from `public/sw.js` — keep one active service worker for the scope.
2. Add an **Enable browser notifications** button (notification settings control). From the signed-in click handler call `enablePreventaPush` with `firebaseApp`, the active `serviceWorkerRegistration`, `vapidKey`, `apiBase` ending in `/api/v1`, and `accessToken` (from `localStorage['preventa.token']`). Save the returned token for that signed-in account and browser. Keep it out of logs and screenshots.
3. In the app, use `onPreventaAlert(firebaseApp, handler)` to render a foreground banner and refresh history — hook it into `useSensors` so the banner, toast history and `NotificationModal` share one source of truth. Unsubscribe the listener when its owner session ends. Handle `event_id` as the incident identifier.
4. In the existing bundled PWA worker (`public/sw.js`), call `enablePreventaPushWorker(firebaseApp, historyPath)` with the real same-origin history path (e.g. `/activity`). Keep a single active worker for the PWA scope. Its background notification opens the history page. Preserve that path through sign-in when needed.
5. For **Disable browser notifications** and before clearing the signed-in JWT on logout (`auth.logout()` clears tokens locally), call `disablePreventaPush` with the saved token and current access token. Report a failed unsubscribe accurately so the user can retry.

| State | What the screen should say or do |
|---|---|
| Ready | Show "Enabled on this browser" after token registration succeeds. The helper sends `POST /notifications/push-subscription/` with `{token}`. Both 201 and 204 are successful. |
| Denied or unsupported | Show how to change browser permission when available, or say push is unavailable on this browser. Keep Fire Event History accessible. |
| Account conflict | On HTTP 409, show that the browser subscription is linked to another account. Ask the user to unregister from that account before retrying. |
| Opted out | The helper sends `DELETE /notifications/push-subscription/` with `{token}`, then removes the Firebase token. The API returns 204. |

> Test with a new incident that reaches Tier 4. Push targets enrolled owner browsers. The A7670C sends SMS independently to the synced contact. The provider's acceptance and the browser displaying a notification are separate observations.

> **Firebase Web setup.** Receiving messages and service-worker integration.

---

## Existing features to finish

| Screen or action | Request and behavior | Codebase status |
|---|---|---|
| Camera gallery | Use `GET /captures/?device_id=<hardware-id>` for time, classification, confidence and image dimensions. For a selected image, fetch `GET /captures/{id}/image/` with the owner JWT, render it as a blob URL, and revoke the URL on cleanup. Use the authenticated image route and keep captures out of worker caches. Handle unavailable images. | **Reverted by product decision** — the standalone `/camera` page and `CaptureGallery.tsx` were removed. Camera captures are only reachable as the ESPCAM snapshot inside `LogDetailModal` (authenticated blob route, "unavailable" state kept). `apiBlob()` / `captureImage(id)` / `fetchCaptureImage()` remain in the API layer. |
| Notification activity | Use `GET /notifications/`. Display channel, event ID, status, and timestamps. Fields such as `contact_id` and delivery time can be absent or `null`. Label sent as "Accepted by push provider." Browser display and SMS receipts are verified separately. | **Done** — `lib/api/notifications.ts` `fetchNotifications()` + DELIVERY ACTIVITY section in `NotificationModal` (fetches on open, loading/error/empty states). |
| Calibration status | Use `GET /baselines/?device_id=<hardware-id>` for the timestamp and available temperature, humidity, gas proxy and current averages. Show these as calibration context. | **Done** — `lib/api/baselines.ts` + "Calibration Status" panel in Settings (per selected device). |
| Residence management | List with `GET /residences/`, create with `POST /residences/` using address and optional latitude and longitude. Use `GET`, `PATCH` or `DELETE /residences/{pk}/` for details, edits or removal. Confirm destructive changes. Removal deletes contacts and unlinks devices from that residence. | **Done** — Profile "Residences" card: list/add/edit (address + optional lat/lng)/two-step delete, device counts via `OwnerDevice.residenceId`. |
| Device registration | Use `POST /devices/register/` with the hardware `device_id` and an owned `residence_id`. The API also accepts an address when creating a new residence. The response returns an `api_key` for setup. Show it once in a private setup view, and keep it out of client caches and logs. | **Done** — Settings "Device Management" card: register form (residence select or "+ New residence…" address) + one-time masked `api_key` reveal with COPY/HIDE. |
| Device removal | Use `DELETE /devices/{pk}/delete/` only after explicit confirmation. Removal deletes associated readings, events, baselines, and capture records. Update the selection and clear the removed device's data from the screen. | **Done** — per-device two-step confirm in the same card; refreshes `useDevices()` so the selection updates. |

### Keep the owner controls aligned with the API

- Leave device keys for device provisioning. Owner browser requests use JWT. Reading and event uploads, remote-config fetch, and heartbeat belong to the device, while the dashboard reads owner-scoped records.
- Keep emergency relay cut, power restore and the manual SMS test in the local setup portal. In the PWA, display the last reported relay state and let the owner configure the SMS contact.
- Check mobile and desktop forms, permission prompts, empty histories, missing values, and one account switch. Keep an owner's address, phone number, images and tokens off shared demo screens unless redacted.
- **Hydration safety:** pages are statically prerendered — gate `new Date()`, clock output, unread badges and any `localStorage` reads behind `lib/useHydrated.ts` so server HTML never mismatches.

> **Code contracts.** `api/urls.py`, `api/views.py`, `api/serializers.py`, `api/models.py` and `preventa_backend/urls.py`.

---

## Acceptance checklist

Use two owner accounts, a demo device, a team-controlled test handset and a supported browser. Record the **Next.js build**, backend build, board firmware, time and result for each completed check.

| Check | Pass condition |
|---|---|
| Contact and recipient | Add two contacts, make one priority 1, edit its phone number, and reload. The displayed recipient follows priority and the edited value persists. An invalid number shows a field error. Test account B cannot access account A's contact. |
| Remote settings | Save an allowed threshold and reporting interval while the demo device is disconnected. The PWA shows a pending status. After connection and the next successful sync and reading, the PWA shows applied time. Confirm camera enablement on the board before claiming camera behavior. |
| SMS receipt | Edit a test contact using the PWA from a different network. After the board applies the change, use the local test SMS control. The intended team handset receives it. |
| Automatic incident | Backend or IoT teammate sends a labeled simulated Tier 2, 3, 4, 4, 2 sequence. History shows one resolved incident at peak Tier 4. Try device and status filters and verify another owner sees no incident. |
| Live reconnect | Disconnect the dashboard network, then reconnect. The UI marks readings stale or reconnecting, refreshes REST data, and resumes live updates for only the selected device. |
| Push foreground and background | Enable from a click. On a new Tier 4 incident, observe the in-app banner with the app focused. On a separate incident with it in the background, observe and tap the browser notification. History opens. Denied permission and opt-out leave history usable. A later incident produces no alert for the opted-out browser. |
| Gallery and session cleanup | Owner can open their captured image. The other account cannot fetch it. Logout clears prior owner state and enrollment for this browser. An empty list and an API failure have distinct messages. |

### Adviser and final defense

Demonstrate the contact edit, pending-to-applied settings change, and one incident lifecycle first. Show the verified browser notification if Firebase integration is ready. Put the date, build IDs, outcome and evidence for each completed check in a separate software functionality table. Keep Rabadon detection rates and timing tied to their recorded sessions.

---

*Updated from `Frontend_Implementation_Handoff.pdf` (Capstone final defense, 6 pages) to reflect the Next.js 16 + React 19 + Cloudflare Workers codebase.*
