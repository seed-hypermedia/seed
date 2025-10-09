import {useNavRoute} from '@shm/shared/utils/navigation'
import {getRouteKey} from '@shm/shared/utils/navigation'
import {useEffect, useRef} from 'react'

/**
 * Hook to handle scroll restoration for custom scroll containers in the desktop app.
 * - Restores scroll position when navigating back/forward (using route key)
 * - Scrolls to top when navigating to a new route
 * Works with the desktop app's navigation system.
 */
export function useScrollRestoration(scrollId: string) {
  const route = useNavRoute()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const viewport = container.querySelector(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLElement

    if (!viewport) return

    const routeKey = getRouteKey(route)
    const key = `scroll-${scrollId}-${routeKey}`

    // Check if we have a saved position for this route
    const savedPosition = sessionStorage.getItem(key)

    if (savedPosition) {
      // Restore saved position (back/forward navigation)
      const scrollTop = parseInt(savedPosition, 10)
      viewport.scrollTo({top: scrollTop, behavior: 'instant'})
    } else {
      // No saved position, scroll to top (new navigation)
      viewport.scrollTo({top: 0, behavior: 'instant'})
    }

    // Save scroll position as user scrolls
    const handleScroll = () => {
      sessionStorage.setItem(key, viewport.scrollTop.toString())
    }

    viewport.addEventListener('scroll', handleScroll, {passive: true})
    return () => {
      viewport.removeEventListener('scroll', handleScroll)
    }
  }, [route, scrollId])

  return scrollContainerRef
}
