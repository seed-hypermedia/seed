import {SidebarWidth, useSidebarContext} from '@/sidebar-context'
import {useNavigate} from '@/utils/useNavigate'
import {Button} from '@shm/ui/button'
import {Tooltip} from '@shm/ui/tooltip'
import {useIsDark} from '@shm/ui/use-is-dark'
import {useStream} from '@shm/ui/use-stream'
import {cn} from '@shm/ui/utils'
import {Settings} from '@tamagui/lucide-icons'
import {ReactNode, useEffect, useRef, useState} from 'react'
import {
  ImperativePanelHandle,
  Panel,
  PanelResizeHandle,
} from 'react-resizable-panels'
import {Separator, useMedia} from 'tamagui'

const HoverRegionWidth = 30

export function GenericSidebarContainer({children}: {children: ReactNode}) {
  const ctx = useSidebarContext()
  const isFocused = useIsWindowFocused({
    onBlur: () => ctx.onMenuHoverLeave(),
  })
  const isWindowTooNarrowForHoverSidebar = useIsWindowNarrowForHoverSidebar()
  const isLocked = useStream(ctx.isLocked)

  const sidebarWidth = useStream(ctx.sidebarWidth)
  const isHoverVisible = useStream(ctx.isHoverVisible)
  const isVisible = isLocked || isHoverVisible
  const isDark = useIsDark()
  const ref = useRef<ImperativePanelHandle>(null)
  const media = useMedia()

  const [wasLocked, setWasLocked] = useState(isLocked)

  const navigate = useNavigate()

  useEffect(() => {
    // this is needed to sync the panel size with the isLocked state
    const panel = ref.current
    if (!panel) return
    if (isLocked) {
      panel.resize(15)
      panel.expand()
    } else {
      panel.collapse()
    }
  }, [isLocked])

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
          className="absolute left-[-20px] rounded-lg bg-gray-100 dark:bg-gray-900 top-0 z-[900] opacity-0 hover:opacity-10 bottom-0"
          style={{width: HoverRegionWidth + 20}}
          onMouseEnter={ctx.onMenuHoverDelayed}
          onMouseLeave={ctx.onMenuHoverLeave}
          onClick={ctx.onMenuHover}
        />
      ) : null}

      <Panel
        defaultSize={sidebarWidth}
        minSize={10}
        maxSize={20}
        ref={ref}
        collapsible
        id="sidebar"
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
          className={cn(
            `w-full flex flex-col transition-all duration-200 ease-in-out h-full px-3`,
            isLocked
              ? 'relative'
              : 'absolute z-[900] shadow-lg border border-gray-300 dark:border-gray-600rounded-tr-lg rounded-br-lg',
            isVisible ? 'opacity-100' : 'opacity-0',
          )}
          style={{
            transform: `translateX(${
              isVisible ? 0 : -SidebarWidth
            }px) translateY(${isLocked ? 0 : 40}px)`,
            maxWidth: isLocked ? undefined : SidebarWidth,
            top: isLocked ? undefined : 8,
            bottom: isLocked ? undefined : 8,
            height: isLocked ? '100%' : 'calc(100% - 60px)',
          }}
          onMouseEnter={ctx.onMenuHover}
          onMouseLeave={ctx.onMenuHoverLeave}
        >
          <div className=" flex-1 overflow-y-auto pt-2 pb-8">{children}</div>
          <div className="shrink-0 flex justify-between p-2">
            <Tooltip content="App Settings">
              <Button
                size="$3"
                backgroundColor={'$colorTransparent'}
                chromeless
                onPress={() => {
                  navigate({key: 'settings'})
                }}
                icon={Settings}
              />
            </Tooltip>
          </div>
        </div>
      </Panel>
      <PanelResizeHandle className="panel-resize-handle" />
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

export function SidebarDivider() {
  return <Separator marginVertical="$2" />
}
