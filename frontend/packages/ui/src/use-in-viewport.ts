import {RefObject, useEffect, useRef, useState} from 'react'

type UseInViewportOptions = {
  /** rootMargin passed to the underlying IntersectionObserver. */
  rootMargin?: string
  /** Keep `isVisible` true for this many ms after the element exits the viewport. */
  graceMs?: number
  /** Initial value of `isVisible` before the observer reports. */
  initialVisible?: boolean
}

/**
 * Tracks whether a DOM element is in (or near) the viewport.
 *
 * Returns a ref to attach to the element being observed and a boolean that
 * stays true for `graceMs` after the element scrolls out of view, to prevent
 * thrash on rapid scroll. The grace period defaults to 30 seconds, which is
 * long enough that quick back-and-forth scrolling does not churn the
 * subscription state of consumers.
 */
export function useInViewport({
  rootMargin = '200px',
  graceMs = 30_000,
  initialVisible = false,
}: UseInViewportOptions = {}): {
  ref: RefObject<HTMLDivElement>
  isVisible: boolean
} {
  const ref = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(initialVisible)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return

    let graceTimer: ReturnType<typeof setTimeout> | null = null
    const clearGrace = () => {
      if (graceTimer) {
        clearTimeout(graceTimer)
        graceTimer = null
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        if (entry.isIntersecting) {
          clearGrace()
          setIsVisible(true)
          return
        }
        if (graceMs <= 0) {
          setIsVisible(false)
          return
        }
        clearGrace()
        graceTimer = setTimeout(() => {
          graceTimer = null
          setIsVisible(false)
        }, graceMs)
      },
      {rootMargin},
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      clearGrace()
    }
  }, [rootMargin, graceMs])

  return {ref, isVisible}
}
