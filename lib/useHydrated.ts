'use client'

import { useSyncExternalStore } from 'react'

let mounted = false

function subscribe(onStoreChange: () => void) {
  mounted = true
  onStoreChange()
  return () => {}
}

function getSnapshot() {
  return mounted
}

function getServerSnapshot() {
  return false
}

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}