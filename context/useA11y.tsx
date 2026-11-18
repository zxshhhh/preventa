'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type MotionPreference = 'system' | 'reduced' | 'full'
export type ContrastPreference = 'system' | 'high' | 'standard'
export type TextScalePreference = 'default' | 'large'

export interface A11ySettings {
  motion: MotionPreference
  contrast: ContrastPreference
  textScale: TextScalePreference
  focusStrong: boolean
}

export const A11Y_DEFAULTS: A11ySettings = {
  motion: 'system',
  contrast: 'system',
  textScale: 'default',
  focusStrong: false,
}

const STORAGE_KEY = 'preventa.a11y'

function pickMotion(value: unknown): MotionPreference {
  return value === 'system' || value === 'reduced' || value === 'full'
    ? value
    : A11Y_DEFAULTS.motion
}

function pickContrast(value: unknown): ContrastPreference {
  return value === 'system' || value === 'high' || value === 'standard'
    ? value
    : A11Y_DEFAULTS.contrast
}

function pickTextScale(value: unknown): TextScalePreference {
  return value === 'default' || value === 'large'
    ? value
    : A11Y_DEFAULTS.textScale
}

export function normalizeA11ySettings(value: unknown): A11ySettings {
  if (!value || typeof value !== 'object') return { ...A11Y_DEFAULTS }
  const raw = value as Record<string, unknown>
  return {
    motion: pickMotion(raw.motion),
    contrast: pickContrast(raw.contrast),
    textScale: pickTextScale(raw.textScale),
    focusStrong: raw.focusStrong === true,
  }
}

function readStoredSettings(): A11ySettings {
  if (typeof window === 'undefined') return { ...A11Y_DEFAULTS }
  try {
    return normalizeA11ySettings(
      JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'),
    )
  } catch {
    return { ...A11Y_DEFAULTS }
  }
}

function queryMatches(query: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.matchMedia(query).matches
  } catch {
    return false
  }
}

export interface EffectiveA11y {
  reduceMotion: boolean
  highContrast: boolean
}

interface A11yContextType {
  settings: A11ySettings
  effective: EffectiveA11y
  setSetting: <K extends keyof A11ySettings>(key: K, value: A11ySettings[K]) => void
  reset: () => void
}

const A11yContext = createContext<A11yContextType | undefined>(undefined)

export function A11yProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<A11ySettings>(() => readStoredSettings())
  const [systemReduceMotion, setSystemReduceMotion] = useState(() =>
    queryMatches('(prefers-reduced-motion: reduce)'),
  )
  const [systemHighContrast, setSystemHighContrast] = useState(
    () =>
      queryMatches('(prefers-contrast: more)') ||
      queryMatches('(forced-colors: active)'),
  )

  // Track the OS accessibility preferences so "system" stays live.
  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const contrastQuery = window.matchMedia('(prefers-contrast: more)')
    const forcedColorsQuery = window.matchMedia('(forced-colors: active)')

    const onChange = () => {
      setSystemReduceMotion(motionQuery.matches)
      setSystemHighContrast(contrastQuery.matches || forcedColorsQuery.matches)
    }

    onChange()
    motionQuery.addEventListener('change', onChange)
    contrastQuery.addEventListener('change', onChange)
    forcedColorsQuery.addEventListener('change', onChange)
    return () => {
      motionQuery.removeEventListener('change', onChange)
      contrastQuery.removeEventListener('change', onChange)
      forcedColorsQuery.removeEventListener('change', onChange)
    }
  }, [])

  // Keep tabs in sync.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return
      try {
        setSettings(normalizeA11ySettings(JSON.parse(event.newValue || '{}')))
      } catch {
        setSettings({ ...A11Y_DEFAULTS })
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const effective: EffectiveA11y = useMemo(
    () => ({
      reduceMotion:
        settings.motion === 'reduced' ||
        (settings.motion === 'system' && systemReduceMotion),
      highContrast:
        settings.contrast === 'high' ||
        (settings.contrast === 'system' && systemHighContrast),
    }),
    [settings.motion, settings.contrast, systemReduceMotion, systemHighContrast],
  )

  // Apply the preference classes before the next paint of any dependent UI.
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('a11y-reduce-motion', effective.reduceMotion)
    root.classList.toggle('a11y-high-contrast', effective.highContrast)
    root.classList.toggle('a11y-focus-strong', settings.focusStrong)
    root.classList.toggle('a11y-text-lg', settings.textScale === 'large')
  }, [
    effective.reduceMotion,
    effective.highContrast,
    settings.focusStrong,
    settings.textScale,
  ])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      /* ignore storage failures */
    }
  }, [settings])

  const setSetting = useCallback(
    <K extends keyof A11ySettings>(key: K, value: A11ySettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }))
    },
    [],
  )

  const reset = useCallback(() => setSettings({ ...A11Y_DEFAULTS }), [])

  const value = useMemo(
    () => ({ settings, effective, setSetting, reset }),
    [settings, effective, setSetting, reset],
  )

  return <A11yContext.Provider value={value}>{children}</A11yContext.Provider>
}

export function useA11y() {
  const context = useContext(A11yContext)
  if (!context) {
    throw new Error('useA11y must be used within an A11yProvider')
  }
  return context
}
