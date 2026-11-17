'use client'

import { useEffect } from 'react'
import { getFirebaseConfig } from '@/lib/api/push'

export default function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // public/sw.js is a module SW that doubles as the Firebase messaging worker;
    // it reads its config from these query params (VAPID key stays page-side).
    const config = getFirebaseConfig()
    const url = config
      ? `/sw.js?${new URLSearchParams({
          apiKey: config.apiKey,
          authDomain: config.authDomain,
          projectId: config.projectId,
          messagingSenderId: config.messagingSenderId,
          appId: config.appId,
        }).toString()}`
      : '/sw.js'
    navigator.serviceWorker.register(url, { type: 'module' }).catch(() => {})
  }, [])

  return null
}
