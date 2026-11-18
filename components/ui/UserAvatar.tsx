'use client'

import { getUsername, initialFor } from '@/lib/api/auth'
import { useHydrated } from '@/lib/useHydrated'

type AvatarSize = 'sm' | 'md' | 'lg'

const SIZE_CLASS: Record<AvatarSize, string> = {
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-35 h-35 md:w-40 md:h-40 text-5xl md:text-6xl',
}

interface UserAvatarProps {
  size?: AvatarSize
  className?: string
}

/**
 * Initial-letter avatar for the signed-in user. The username lives in localStorage,
 * so it is read only after hydration to keep the prerendered HTML identical.
 */
export default function UserAvatar({ size = 'md', className = '' }: UserAvatarProps) {
  const hydrated = useHydrated()
  const username = hydrated ? getUsername() : null
  const initial = hydrated ? initialFor(username) : ''

  return (
    <span
      role="img"
      aria-label={username ? `${username} profile avatar` : 'Profile avatar'}
      title={username ?? undefined}
      className={
        'rounded-full bg-ember text-white font-extrabold flex items-center justify-center select-none shrink-0 ' +
        SIZE_CLASS[size] +
        (className ? ' ' + className : '')
      }
    >
      {initial}
    </span>
  )
}
