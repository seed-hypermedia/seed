import {useLocation} from '@remix-run/react'
import {useRef} from 'react'
import {useScrollRestoration as useScrollRestorationBase} from '@shm/ui/use-scroll-restoration'

/**
 * Web app wrapper for scroll restoration hook.
 * Uses Remix's navigation system with hash-only change detection.
 */
export function useScrollRestoration(
  scrollId: string,
  useNativeScroll = false,
) {
  const location = useLocation()
  const previousPathnameRef = useRef(location.pathname)
  const previousSearchRef = useRef(location.search)

  return useScrollRestorationBase({
    scrollId,
    getStorageKey: () => location.key,
    useNativeScroll,
    debug: false,
    shouldSkipRestoration: () => {
      // Check window.location.hash directly - Remix's location might not be
      // synced yet during hydration, causing scroll-to-top before hash check
      if (typeof window !== 'undefined' && window.location.hash) {
        return true
      }

      // Also check Remix location for client-side navigations
      if (location.hash) {
        return true
      }

      // Skip scroll restoration for hash-only changes (e.g., clicking blocks in document outline)
      // This allows smooth scrolling to blocks without resetting scroll position
      const isHashOnlyChange =
        location.pathname === previousPathnameRef.current &&
        location.search === previousSearchRef.current

      if (!isHashOnlyChange) {
        // Update refs for next comparison
        previousPathnameRef.current = location.pathname
        previousSearchRef.current = location.search
      }

      return isHashOnlyChange
    },
  })
}
