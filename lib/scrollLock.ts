const SCROLL_KEYS = new Set([
  ' ', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End',
])

function canScroll(el: Element, deltaY: number): boolean {
  let node: HTMLElement | null = el as HTMLElement
  while (node && node !== document.body) {
    const style = getComputedStyle(node)
    const overflowY = style.overflowY
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      const max = node.scrollHeight - node.clientHeight
      const top = node.scrollTop
      if (deltaY < 0 ? top > 0 : top < max - 1) return true
    }
    node = node.parentElement
  }
  return false
}

function forbidScroll(e: Event) {
  const deltaY = (e as WheelEvent).deltaY ?? 0
  if (deltaY !== 0 && e.target instanceof Element && canScroll(e.target, deltaY)) return
  e.preventDefault()
}

function forbidKeyScroll(e: KeyboardEvent) {
  if (!SCROLL_KEYS.has(e.key)) return
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  if (target instanceof Element && canScroll(target, 1)) return
  e.preventDefault()
}

export function lockScroll(): () => void {
  window.addEventListener('wheel', forbidScroll, { passive: false })
  window.addEventListener('touchmove', forbidScroll, { passive: false })
  window.addEventListener('keydown', forbidKeyScroll)
  return () => {
    window.removeEventListener('wheel', forbidScroll)
    window.removeEventListener('touchmove', forbidScroll)
    window.removeEventListener('keydown', forbidKeyScroll)
  }
}