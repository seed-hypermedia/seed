import {useLocation} from '@remix-run/react'
import {useEffect, useRef} from 'react'

/**
 * Hook to handle scroll restoration for custom scroll containers.
 * - Restores scroll position when navigating back/forward (using location.key)
 * - Scrolls to top when navigating to a new route
 * Works with Remix's navigation system, similar to ScrollRestoration but for custom scroll areas.
 */
export function useScrollRestoration(
  scrollId: string,
  useNativeScroll = false,
) {
  const location = useLocation()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const viewport = useNativeScroll
      ? container
      : (container.querySelector(
          '[data-slot="scroll-area-viewport"]',
        ) as HTMLElement)

    if (!viewport) return

    const key = `scroll-${scrollId}-${location.key}`

    // Check if we have a saved position for this location.key
    const savedPosition = sessionStorage.getItem(key)

    if (savedPosition) {
      // Restore saved position (back/forward navigation)
      const scrollTop = parseInt(savedPosition, 10)
      viewport.scrollTo({top: scrollTop, behavior: 'instant'})
    } else {
      // No saved position, scroll to top (new navigation)
      viewport.scrollTo({top: 0, behavior: 'instant'})
    }

    // Save scroll position as user scrolls (throttled to ~60fps)
    let scrollTimeout: NodeJS.Timeout
    const handleScroll = () => {
      if (scrollTimeout) clearTimeout(scrollTimeout)
      scrollTimeout = setTimeout(() => {
        sessionStorage.setItem(key, viewport.scrollTop.toString())
      }, 16) // ~60fps
    }

    viewport.addEventListener('scroll', handleScroll, {passive: true})
    return () => {
      viewport.removeEventListener('scroll', handleScroll)
      if (scrollTimeout) clearTimeout(scrollTimeout)
    }
  }, [location.key, scrollId, useNativeScroll])

  return scrollContainerRef
}
