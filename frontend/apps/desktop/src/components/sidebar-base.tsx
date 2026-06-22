import {SidebarWidth, useSidebarContext} from '@/sidebar-context'

import {useAppContext} from '@/app-context'
import {useStream} from '@shm/shared/use-stream'
import useMedia from '@shm/ui/use-media'
import {cn} from '@shm/ui/utils'
import {ReactNode, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {ImperativePanelHandle, Panel, PanelResizeHandle} from 'react-resizable-panels'

const HoverRegionWidth = 30

export function GenericSidebarContainer({
  children,
  footer,
}: {
  children: ReactNode
  footer?: (props: {isVisible?: boolean}) => ReactNode
}) {
  const ctx = useSidebarContext()
  const isFocused = useIsWindowFocused({
    onBlur: () => ctx.onMenuHoverLeave(),
  })
  const isWindowTooNarrowForHoverSidebar = useIsWindowNarrowForHoverSidebar()
  const isLocked = useStream(ctx.isLocked)

  const sidebarWidth = useStream(ctx.sidebarWidth)
  const isHoverVisible = useStream(ctx.isHoverVisible)
  const isVisible = isLocked || isHoverVisible
  const ref = useRef<ImperativePanelHandle>(null)
  const panelContentRef = useRef<HTMLDivElement>(null)
  const prevIsLocked = useRef<boolean | undefined>(undefined)
  const media = useMedia()

  const {platform} = useAppContext()

  // Enforce 250px minimum when locking sidebar open.
  // useEffect (not useLayoutEffect) so it runs after Panel's own layout-effect
  // registration completes — avoids "Panel size not found" assertion when the
  // imperative ref is invoked before the PanelGroup has the panel in its map.
  useEffect(() => {
    const isOpening = prevIsLocked.current === false && isLocked === true
    const isInitialMount = prevIsLocked.current === undefined && isLocked === true

    const panel = ref.current
    if (!panel) return

    const safeResize = (pct: number) => {
      try {
        panel.resize(pct)
      } catch (error) {
        console.log('[250px constraint] Panel operation failed (panel not ready yet):', error)
      }
    }
    const safeExpand = () => {
      try {
        panel.expand()
      } catch (error) {
        console.log('[250px constraint] Panel operation failed (panel not ready yet):', error)
      }
    }
    const safeCollapse = () => {
      try {
        panel.collapse()
      } catch (error) {
        console.log('[250px constraint] Panel operation failed (panel not ready yet):', error)
      }
    }

    if (isLocked && (isOpening || isInitialMount)) {
      // Use requestAnimationFrame to ensure layout is complete before measuring
      requestAnimationFrame(() => {
        const containerWidth = window.innerWidth
        const storedPercent = sidebarWidth || 15
        const pixelValue = (storedPercent / 100) * containerWidth

        if (pixelValue < 250) {
          const newPercent = Math.min(30, (250 / containerWidth) * 100)
          // console.log('[250px constraint] Adjusting to:', newPercent)
          safeResize(newPercent)
          ctx.onSidebarResize(newPercent)
        }
        safeExpand()
      })
    } else if (isLocked && !isOpening && !isInitialMount) {
      safeResize(sidebarWidth || 15)
      safeExpand()
    } else if (!isLocked) {
      safeCollapse()
    }

    prevIsLocked.current = isLocked
  }, [isLocked, sidebarWidth, ctx])

  // When window shrinks past the breakpoint, close the sidebar (and restore it when growing back)
  const prevMediaGtSm = useRef(media.gtSm)
  const wasLockedBeforeCollapse = useRef(false)
  useLayoutEffect(() => {
    if (prevMediaGtSm.current && !media.gtSm) {
      if (isLocked) {
        wasLockedBeforeCollapse.current = true
        ctx.onCloseSidebar()
      }
    } else if (!prevMediaGtSm.current && media.gtSm) {
      if (wasLockedBeforeCollapse.current) {
        wasLockedBeforeCollapse.current = false
        ctx.onLockSidebarOpen()
      }
    }
    prevMediaGtSm.current = media.gtSm
  }, [media.gtSm])

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
      {isFocused && !isLocked && !isWindowTooNarrowForHoverSidebar ? (
        <div
          className="absolute top-0 bottom-0 left-[-20px] z-50 rounded-lg bg-gray-100 opacity-0 hover:opacity-10 dark:bg-gray-900"
          style={{width: HoverRegionWidth + 20}}
          // onMouseEnter={ctx.onMenuHoverDelayed}
          // onMouseLeave={ctx.onMenuHoverLeave}
          onClick={ctx.onMenuHover}
        />
      ) : null}

      <Panel
        defaultSize={sidebarWidth}
        minSize={10}
        maxSize={30}
        ref={ref}
        collapsible
        id="sidebar"
        order={1}
        className="h-full"
        onResize={(size) => {
          ctx.onSidebarResize(size)
        }}
      >
        <div
          ref={panelContentRef}
          className={cn(
            `flex h-full w-full flex-col transition-all duration-200 ease-in-out`,
            isLocked
              ? 'relative'
              : 'border-border bg-background absolute z-[51] rounded-tr-lg rounded-br-lg border shadow-lg dark:bg-black',
            isVisible ? 'opacity-100' : 'opacity-0',
          )}
          style={{
            transform: `translateX(${isVisible ? 0 : -SidebarWidth}px) translateY(${isLocked ? 0 : 40}px)`,
            maxWidth: isLocked ? undefined : SidebarWidth,
            top: isLocked ? undefined : platform === 'win32' ? 24 : 8,
            bottom: isLocked ? undefined : 8,
            height: isLocked ? '100%' : 'calc(100% - 60px)',
          }}
          // onMouseEnter={ctx.onMenuHover}
          // onMouseLeave={ctx.onMenuHoverLeave}
        >
          <div className={cn('flex-1 overflow-y-auto pb-8', isLocked ? '' : 'py-2')}>{children}</div>
          {footer ? (
            <div
              className={cn(
                'w-full items-end',
                // isLocked ? '':'pb-2 pr-1',
              )}
            >
              {footer({isVisible})}
            </div>
          ) : null}
        </div>
      </Panel>
      {isLocked ? <PanelResizeHandle className="panel-resize-handle" /> : null}
    </>
  )
}

export const useIsWindowFocused = ({onFocus, onBlur}: {onFocus?: () => void; onBlur?: () => void}): boolean => {
  const [isFocused, setIsFocused] = useState(document.hasFocus())
  useEffect(() => {
    const handleFocus = () => {
      onFocus?.()
      setIsFocused(true)
    }
    const handleBlur = () => {
      onBlur?.()
      setIsFocused(false)
    }
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])
  return isFocused
}

function useIsWindowNarrowForHoverSidebar() {
  const [isWindowTooNarrowForHoverSidebar, setIsWindowTooNarrowForHoverSidebar] = useState(window.innerWidth < 820)
  useEffect(() => {
    const handleResize = () => {
      setIsWindowTooNarrowForHoverSidebar(window.innerWidth < 820)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])
  return isWindowTooNarrowForHoverSidebar
}
