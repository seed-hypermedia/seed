import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {type ReactNode, useId, useRef, useState} from 'react'

/**
 * Keep SSR content visible for two frames after the editor mounts: its node
 * views flush a frame later, so removing the placeholder immediately flashes.
 */
export function DocumentContentHandoff({
  ssrContentHTML,
  editorMounted,
  children,
}: {
  ssrContentHTML?: string | null
  editorMounted: boolean
  children: ReactNode
}) {
  const placeholderId = useId()
  // The initial document already contains this HTML; it need not be sent again
  // in loader data. Client navigations still receive the loader's HTML directly.
  const [initialHTML] = useState(
    () =>
      ssrContentHTML || (typeof document !== 'undefined' ? document.getElementById(placeholderId)?.innerHTML : null),
  )
  const contentHTML = ssrContentHTML ?? initialHTML
  const containerRef = useRef<HTMLDivElement>(null)
  const placeholderRef = useRef<HTMLDivElement>(null)
  const [settled, setSettled] = useState(false)

  useIsomorphicLayoutEffect(() => {
    if (!editorMounted || settled) return
    // Hold the height while the editor lays out behind the placeholder overlay.
    if (containerRef.current && placeholderRef.current) {
      containerRef.current.style.minHeight = `${placeholderRef.current.offsetHeight}px`
    }
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (containerRef.current) containerRef.current.style.minHeight = ''
        setSettled(true)
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [editorMounted, settled])

  if (!contentHTML) return <>{children}</>

  return (
    <div ref={containerRef} className="relative">
      {children}
      {!settled && (
        <div
          id={placeholderId}
          ref={placeholderRef}
          className={editorMounted ? 'dark:bg-background absolute inset-x-0 top-0 z-10 bg-white' : undefined}
          dangerouslySetInnerHTML={{__html: contentHTML}}
        />
      )}
    </div>
  )
}
