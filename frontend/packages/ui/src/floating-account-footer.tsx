import { ReactNode, useEffect, useState } from 'react'
import { cn } from './utils'

export interface FloatingAccountFooterProps {
  children?: ReactNode
  /** The floating button content (account avatar or join button) */
  floatingButton: ReactNode
  /** Extra content to render (e.g., dialogs) */
  extraContent?: ReactNode
  /** Whether to lift the button when a page footer is visible */
  liftForPageFooter?: boolean
}

/**
 * Shared floating footer component that positions an account/join button
 * in the bottom-left corner of the page. Used by both web and desktop.
 */
export function FloatingAccountFooter({
  children,
  floatingButton,
  extraContent,
  liftForPageFooter = false,
}: FloatingAccountFooterProps) {
  const [footerLiftPx, setFooterLiftPx] = useState(0)

  useEffect(() => {
    if (!liftForPageFooter || typeof window === 'undefined') {
      setFooterLiftPx(0)
      return
    }

    let pageFooter: HTMLElement | null = null
    let intersectionObserver: IntersectionObserver | null = null
    let resizeObserver: ResizeObserver | null = null

    const cleanupObservers = () => {
      intersectionObserver?.disconnect()
      resizeObserver?.disconnect()
      intersectionObserver = null
      resizeObserver = null
    }

    const attachToFooter = () => {
      const nextFooter = document.querySelector<HTMLElement>('[data-page-footer="true"]')
      if (!nextFooter || nextFooter === pageFooter) return

      cleanupObservers()
      pageFooter = nextFooter

      const updateLift = (isVisible: boolean) => {
        if (!pageFooter || !isVisible) {
          setFooterLiftPx(0)
          return
        }
        // Keep the floating account button above the currently visible footer.
        setFooterLiftPx(Math.ceil(pageFooter.getBoundingClientRect().height) + 8)
      }

      intersectionObserver = new IntersectionObserver((entries) => {
        const entry = entries[0]
        updateLift(!!entry?.isIntersecting)
      })
      intersectionObserver.observe(pageFooter)

      resizeObserver = new ResizeObserver(() => {
        const rect = pageFooter?.getBoundingClientRect()
        if (!rect) return
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          updateLift(true)
        }
      })
      resizeObserver.observe(pageFooter)
    }

    attachToFooter()

    const mutationObserver = new MutationObserver(() => {
      attachToFooter()
    })
    mutationObserver.observe(document.body, {childList: true, subtree: true})

    return () => {
      mutationObserver.disconnect()
      cleanupObservers()
    }
  }, [liftForPageFooter])

  return (
    <>
      {children}
      <div
        style={{bottom: `calc(1rem + ${footerLiftPx}px)`}}
        className={cn('fixed left-4 z-30 transition-[bottom] duration-200 flex gap-2 items-center')}
      >
        {floatingButton}
      </div>
      {extraContent}
    </>
  )
}
