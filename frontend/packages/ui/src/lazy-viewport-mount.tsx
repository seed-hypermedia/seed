import {ReactNode, useEffect, useRef, useState} from 'react'

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
  const [hasMountedOnce, setHasMountedOnce] = useState(active)

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
