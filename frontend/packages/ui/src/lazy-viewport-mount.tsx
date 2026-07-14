import {ReactNode, useEffect, useRef, useState} from 'react'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'

/** Mounts children only after the wrapper nears the viewport, or immediately when active. */
export function LazyViewportMount({
  children,
  active = false,
  placeholder = null,
  rootMargin = '1200px 0px',
}: {
  children: ReactNode
  active?: boolean
  placeholder?: ReactNode
  rootMargin?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Server-side there is no viewport to observe: render children so SSR HTML
  // is complete. (SSR document HTML is injected as a static string, never
  // React-hydrated, so diverging from the client's first render is safe.)
  const [hasMountedOnce, setHasMountedOnce] = useState(active || typeof window === 'undefined')

  // Synchronous near-viewport check before first paint: content the SSR
  // placeholder already showed must not blank out for an IntersectionObserver
  // round-trip when the editor mounts over it. Layout-effect state updates
  // flush before the browser paints, so this causes no visible flash.
  useIsomorphicLayoutEffect(() => {
    if (hasMountedOnce || typeof window === 'undefined') return
    const el = ref.current
    if (!el) return
    const margin = parseFloat(rootMargin) || 0
    const rect = el.getBoundingClientRect()
    if (rect.top < window.innerHeight + margin && rect.bottom > -margin) {
      setHasMountedOnce(true)
    }
  }, [])

  useEffect(() => {
    if (active) {
      setHasMountedOnce(true)
      return
    }

    const el = ref.current
    if (!el || hasMountedOnce) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        setHasMountedOnce(true)
        observer.disconnect()
      },
      {rootMargin},
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [active, hasMountedOnce, rootMargin])

  return <div ref={ref}>{hasMountedOnce ? children : placeholder}</div>
}
