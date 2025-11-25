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
