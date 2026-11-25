import type { HTMLAttributes } from 'react'

type InlineSkeletonProps = HTMLAttributes<HTMLSpanElement>
type BlockSkeletonProps = HTMLAttributes<HTMLDivElement>

/** Small placeholder for text-sized values. The parent owns the status label. */
export function SkeletonBar({ className = '', ...props }: InlineSkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton-shine inline-block shrink-0 rounded bg-white/10 align-middle ${className}`}
      {...props}
    />
  )
}

/** Larger placeholder for cards, image frames and row blocks. */
export function SkeletonBlock({ className = '', ...props }: BlockSkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`skeleton-shine bg-white/5 ${className}`}
      {...props}
    />
  )
}

/** Circular placeholder for avatars and status dots. */
export function SkeletonCircle({ className = '', ...props }: InlineSkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton-shine inline-block shrink-0 rounded-full bg-white/10 align-middle ${className}`}
      {...props}
    />
  )
}
