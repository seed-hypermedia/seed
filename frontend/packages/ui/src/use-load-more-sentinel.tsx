import {useCallback, useEffect, useRef} from 'react'

/** Distance below the visible area, in px, at which the next page is requested by default. */
const DEFAULT_PREFETCH_MARGIN = 1500

/** The nearest ancestor that scrolls vertically, which is the intersection root the sentinel needs. */
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null
  while (current) {
    const {overflowY} = getComputedStyle(current)
    if (overflowY === 'auto' || overflowY === 'scroll') return current
    current = current.parentElement
  }
  return null
}

/**
 * Infinite scrolling for a paged list: attach the returned ref to an empty element after the last
 * row and `onLoadMore` fires whenever that element comes within `margin` px of the scroll
 * container's visible area — far enough ahead that a reader scrolling at a normal pace never meets
 * the end of the loaded rows. Pass `enabled: false` while a page is loading or none remain; each
 * re-enable re-checks the sentinel, so a viewport the first page could not fill keeps loading
 * until it can.
 */
export function useLoadMoreSentinel({
  enabled,
  onLoadMore,
  margin = DEFAULT_PREFETCH_MARGIN,
}: {
  enabled: boolean
  onLoadMore: () => void
  margin?: number
}) {
  const nodeRef = useRef<HTMLElement | null>(null)
  const loadMoreRef = useRef(onLoadMore)
  loadMoreRef.current = onLoadMore
  // Bumps when the element mounts, so the effect below can observe a node that arrives late.
  const versionRef = useRef(0)
  const setNode = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node
    versionRef.current += 1
  }, [])

  useEffect(() => {
    const node = nodeRef.current
    if (!enabled || !node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current()
      },
      {root: findScrollParent(node), rootMargin: `0px 0px ${margin}px 0px`},
    )
    observer.observe(node)
    return () => observer.disconnect()
    // versionRef is read so a sentinel that mounts after the first render is picked up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, margin, versionRef.current])

  return setNode
}
