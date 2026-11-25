import {useSidebarContext} from '@/sidebar-context'
import {useStream} from '@shm/shared/use-stream'
import useMedia from '@shm/ui/use-media'
import {ReactNode, useLayoutEffect, useRef} from 'react'
import {AnimatedPanel, PanelSeparator} from '@shm/ui/resizable-panels'

export function GenericSidebarContainer({
  children,
  footer,
}: {
  children: ReactNode
  footer?: (props: {isVisible?: boolean}) => ReactNode
}) {
  const ctx = useSidebarContext()
  const isLocked = useStream(ctx.isLocked)

  const sidebarWidth = useStream(ctx.sidebarWidth)
  const panelContentRef = useRef<HTMLDivElement>(null)
  const media = useMedia()

  // When window shrinks past the breakpoint, close the sidebar (and restore it when growing back)
  const prevMediaGtSm = useRef(media.gtSm)
  const wasLockedBeforeCollapse = useRef(false)
  const responsiveTarget = useRef<boolean | undefined>(undefined)
  const expandedSize = `${Math.min(30, Math.max(sidebarWidth || 15, (250 / window.innerWidth) * 100))}%`
  useLayoutEffect(() => {
    if (prevMediaGtSm.current && !media.gtSm) {
      if (isLocked) {
        wasLockedBeforeCollapse.current = true
        responsiveTarget.current = false
        ctx.onCloseSidebar()
      }
    } else if (!prevMediaGtSm.current && media.gtSm) {
      if (wasLockedBeforeCollapse.current) {
        wasLockedBeforeCollapse.current = false
        responsiveTarget.current = true
        ctx.onLockSidebarOpen()
      }
    }
    prevMediaGtSm.current = media.gtSm
  }, [media.gtSm])

  useLayoutEffect(() => {
    if (responsiveTarget.current === isLocked) responsiveTarget.current = undefined
  }, [isLocked])

  useLayoutEffect(() => {
    const element = panelContentRef.current
    if (!element) return

    const updateSidebarWidthPx = () => {
      if (!isLocked) return
      const width = element.getBoundingClientRect().width
      if (width > 0) ctx.onSidebarWidthPxChange(width)
    }

    updateSidebarWidthPx()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSidebarWidthPx)
      return () => {
        window.removeEventListener('resize', updateSidebarWidthPx)
      }
    }

    const resizeObserver = new ResizeObserver(updateSidebarWidthPx)
    resizeObserver.observe(element)

    return () => {
      resizeObserver.disconnect()
    }
  }, [ctx, isLocked])

  return (
    <>
      <AnimatedPanel
        open={!!isLocked}
        keepMounted
        animate={responsiveTarget.current !== isLocked}
        defaultSize={expandedSize}
        openSize={expandedSize}
        minSize="10%"
        maxSize="30%"
        id="sidebar"
        className="h-full"
      >
        <div ref={panelContentRef} className="relative flex h-full w-full flex-col">
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
          {footer ? <div className="w-full items-end">{footer({isVisible: isLocked})}</div> : null}
        </div>
      </AnimatedPanel>
      <PanelSeparator open={!!isLocked} />
    </>
  )
}
