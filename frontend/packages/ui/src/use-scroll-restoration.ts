import {useCallback, useEffect, useState} from 'react'

export type ScrollRestorationOptions = {
  /** Unique identifier for this scroll area */
  scrollId: string
  /** Function to generate storage key from current navigation state */
  getStorageKey: () => string
  /** Whether to use native scroll instead of custom scroll area */
  useNativeScroll?: boolean
  /** Enable debug logging */
  debug?: boolean
  /** Optional function to detect if navigation should skip scroll restoration (e.g., hash-only changes) */
  shouldSkipRestoration?: () => boolean
}

/**
 * Hook to handle scroll restoration for custom scroll containers.
 * - Restores scroll position when navigating back/forward
 * - Scrolls to top when navigating to a new route
 * - Works with any navigation system (Remix, custom, etc.)
 *
 * @example
 * // Desktop app with custom navigation
 * const route = useNavRoute()
 * const scrollRef = useScrollRestoration({
 *   scrollId: `activity-${docId.id}`,
 *   getStorageKey: () => `${getRouteKey(route)}`,
 * })
 *
 * @example
 * // Web app with Remix
 * const location = useLocation()
 * const scrollRef = useScrollRestoration({
 *   scrollId: `activity-${docId.id}`,
 *   getStorageKey: () => location.key,
 * })
 */
export function useScrollRestoration(options: ScrollRestorationOptions) {
  const {
    scrollId,
    getStorageKey,
    useNativeScroll = false,
    debug = false,
    shouldSkipRestoration,
  } = options

  const [viewport, setViewport] = useState<HTMLElement | null>(null)
  const storageKey = getStorageKey()

  // Callback ref to capture the container when it mounts
  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        const vp = useNativeScroll
          ? node
          : (node.querySelector(
              '[data-slot="scroll-area-viewport"]',
            ) as HTMLElement)
        if (debug) {
          console.log(
            `[SCROLL_RESTORE:${scrollId}] Container ref set, viewport:`,
            !!vp,
          )
        }
        setViewport(vp)
      } else {
        setViewport(null)
      }
    },
    [scrollId, useNativeScroll, debug],
  )

  useEffect(() => {
    if (!viewport) {
      if (debug) {
        console.log(`[SCROLL_RESTORE:${scrollId}] No viewport in effect`)
      }
      return
    }

    // Skip restoration if needed (e.g., hash-only changes)
    if (shouldSkipRestoration?.()) {
      if (debug) {
        console.log(`[SCROLL_RESTORE:${scrollId}] Skipping restoration`)
      }
      return
    }

    const key = `scroll-${scrollId}-${storageKey}`

    if (debug) {
      console.log(`[SCROLL_RESTORE:${scrollId}] Effect running`, {
        scrollId,
        storageKey,
        key,
        currentScrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
      })
    }

    // Check if we have a saved position for this storage key
    const savedPosition = sessionStorage.getItem(key)

    if (savedPosition) {
      // Restore saved position (back/forward navigation)
      const scrollTop = parseInt(savedPosition, 10)
      if (debug) {
        console.log(`[SCROLL_RESTORE:${scrollId}] Restoring scroll position`, {
          savedPosition: scrollTop,
          scrollHeight: viewport.scrollHeight,
          clientHeight: viewport.clientHeight,
          maxScroll: viewport.scrollHeight - viewport.clientHeight,
        })
      }
      viewport.scrollTo({top: scrollTop, behavior: 'instant'})

      // Log actual position after restoration
      if (debug) {
        setTimeout(() => {
          console.log(`[SCROLL_RESTORE:${scrollId}] After restore`, {
            scrollTop: viewport.scrollTop,
            expectedScrollTop: scrollTop,
            restored: viewport.scrollTop === scrollTop,
          })
        }, 0)
      }
    } else {
      // No saved position, scroll to top (new navigation)
      if (debug) {
        console.log(
          `[SCROLL_RESTORE:${scrollId}] No saved position, scrolling to top`,
        )
      }
      viewport.scrollTo({top: 0, behavior: 'instant'})
    }

    // Save scroll position as user scrolls (throttled to ~60fps)
    let scrollTimeout: NodeJS.Timeout
    let lastLogTime = 0

    const handleScroll = () => {
      if (scrollTimeout) clearTimeout(scrollTimeout)
      scrollTimeout = setTimeout(() => {
        sessionStorage.setItem(key, viewport.scrollTop.toString())

        // Throttle logging to every 500ms to reduce noise
        if (debug) {
          const now = Date.now()
          if (now - lastLogTime > 500) {
            console.log(`[SCROLL_RESTORE:${scrollId}] Saving scroll position`, {
              scrollTop: viewport.scrollTop,
              scrollHeight: viewport.scrollHeight,
              storageKey: key,
            })
            lastLogTime = now
          }
        }
      }, 16) // ~60fps
    }

    if (debug) {
      console.log(
        `[SCROLL_RESTORE:${scrollId}] Scroll listener attached to viewport`,
      )
    }
    viewport.addEventListener('scroll', handleScroll, {passive: true})

    return () => {
      if (debug) {
        console.log(
          `[SCROLL_RESTORE:${scrollId}] Cleanup, removing scroll listener`,
        )
      }
      viewport.removeEventListener('scroll', handleScroll)
      if (scrollTimeout) clearTimeout(scrollTimeout)
    }
  }, [storageKey, scrollId, viewport, debug, shouldSkipRestoration])

  return setContainerRef
}
