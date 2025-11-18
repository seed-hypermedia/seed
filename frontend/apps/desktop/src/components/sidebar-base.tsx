import {SidebarWidth, useSidebarContext} from '@/sidebar-context'

import {useAppContext} from '@/app-context'
import {useStream} from '@shm/shared/use-stream'
import useMedia from '@shm/ui/use-media'
import {cn} from '@shm/ui/utils'
import {ReactNode, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {
  ImperativePanelHandle,
  Panel,
  PanelResizeHandle,
} from 'react-resizable-panels'

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

  const [wasLocked, setWasLocked] = useState(isLocked)

  const {platform} = useAppContext()

  // Enforce 250px minimum when locking sidebar open
  useLayoutEffect(() => {
    const isOpening = prevIsLocked.current === false && isLocked === true
    const isInitialMount =
      prevIsLocked.current === undefined && isLocked === true

    console.log('[250px constraint] Effect running:', {
      prevIsLocked: prevIsLocked.current,
      currentIsLocked: isLocked,
      isOpening,
      isInitialMount,
    })

    const panel = ref.current
    if (!panel) return

    try {
      if (isLocked && (isOpening || isInitialMount)) {
        // Use requestAnimationFrame to ensure layout is complete before measuring
        requestAnimationFrame(() => {
          // Use window width as the container since we can't reliably measure the PanelGroup
          const containerWidth = window.innerWidth
          const storedPercent = sidebarWidth || 15
          const pixelValue = (storedPercent / 100) * containerWidth

          console.log('[250px constraint] Width calculation:', {
            windowWidth: containerWidth,
            storedPercent,
            pixelValue,
            needsAdjustment: pixelValue < 250,
          })

          // If the stored percentage would result in less than 250px, adjust it
          if (pixelValue < 250) {
            const newPercent = Math.min(30, (250 / containerWidth) * 100)
            console.log('[250px constraint] Adjusting to:', newPercent)
            panel.resize(newPercent)
            ctx.onSidebarResize(newPercent)
          }
          // Otherwise don't resize - let it use the stored value naturally
        })
        panel.expand()
      } else if (isLocked && !isOpening && !isInitialMount) {
        // Just sync the size without enforcing minimum
        panel.resize(sidebarWidth || 15)
        panel.expand()
      } else if (!isLocked) {
        panel.collapse()
      }
    } catch (error) {
      console.log(
        '[250px constraint] Panel operation failed (panel not ready yet):',
        error,
      )
    }

    prevIsLocked.current = isLocked
  }, [isLocked, sidebarWidth, ctx])

  useEffect(() => {
    // This is needed to ensure the left sidebar is not visible on mobile. and if it was locked, it will be expanded when on desktop.
    if (media.gtSm) {
      const panel = ref.current
      if (!panel) return
      if (wasLocked) {
        panel.resize(sidebarWidth || 0)
        panel.expand()
      }
      if (!isLocked) {
        setWasLocked(false)
      }
    } else {
      if (isLocked) {
        setWasLocked(true)
      }
      const panel = ref.current
      if (!panel) return
      panel.collapse()
    }
  }, [media.gtSm, wasLocked, isLocked])

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
        onCollapse={() => {
          ctx.onCloseSidebar()
        }}
        onResize={(size) => {
          ctx.onSidebarResize(size)
        }}
        onExpand={() => {
          ctx.onLockSidebarOpen()
        }}
      >
        <div
          ref={panelContentRef}
          className={cn(
            `flex h-full w-full flex-col pr-1 transition-all duration-200 ease-in-out`,
            isLocked
              ? 'relative'
              : 'border-border bg-background absolute z-[51] rounded-tr-lg rounded-br-lg border shadow-lg dark:bg-black',
            isVisible ? 'opacity-100' : 'opacity-0',
          )}
          style={{
            transform: `translateX(${
              isVisible ? 0 : -SidebarWidth
            }px) translateY(${isLocked ? 0 : 40}px)`,
            maxWidth: isLocked ? undefined : SidebarWidth,
            top: isLocked ? undefined : platform === 'win32' ? 24 : 8,
            bottom: isLocked ? undefined : 8,
            height: isLocked ? '100%' : 'calc(100% - 60px)',
          }}
          // onMouseEnter={ctx.onMenuHover}
          // onMouseLeave={ctx.onMenuHoverLeave}
        >
          <div
            className={cn(
              'flex-1 overflow-y-auto pb-8',
              isLocked ? '' : 'py-2 pr-1',
            )}
          >
            {children}
          </div>
          {footer ? (
            <div
              className={cn(
                'flex w-full items-end',
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

export const useIsWindowFocused = ({
  onFocus,
  onBlur,
}: {
  onFocus?: () => void
  onBlur?: () => void
}): boolean => {
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
  const [
    isWindowTooNarrowForHoverSidebar,
    setIsWindowTooNarrowForHoverSidebar,
  ] = useState(window.innerWidth < 820)
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
