import {SidebarWidth, useSidebarContext} from '@/sidebar-context'
import {useNavigate} from '@/utils/useNavigate'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {Button} from '@shm/ui/button'
import {Tooltip} from '@shm/ui/tooltip'
import {useIsDark} from '@shm/ui/use-is-dark'
import {useStream} from '@shm/ui/use-stream'
import {Hash, Settings} from '@tamagui/lucide-icons'
import {ComponentProps, FC, ReactNode, useEffect, useRef, useState} from 'react'
import {
  ImperativePanelHandle,
  Panel,
  PanelResizeHandle,
} from 'react-resizable-panels'
import {Separator, useMedia, XStack, YStack} from 'tamagui'

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
        <YStack
          position="absolute"
          left={-20} // this -20 is to make sure the rounded radius is not visible on the edge
          borderRadius={'$3'}
          bg="$backgroundStrong"
          width={HoverRegionWidth + 20} // this 20 is to make sure the rounded radius is not visible on the edge
          top={0}
          zi="$zIndex.9"
          opacity={0}
          hoverStyle={{
            opacity: 0.1,
          }}
          bottom={0}
          onMouseEnter={ctx.onMenuHoverDelayed}
          onMouseLeave={ctx.onMenuHoverLeave}
          onPress={ctx.onMenuHover}
        />
      ) : null}

      <Panel
        defaultSize={sidebarWidth}
        minSize={10}
        maxSize={20}
        ref={ref}
        collapsible
        id="sidebar"
        onCollapse={() => {
          console.log('=== Sidebar onCollapse call')
          ctx.onCloseSidebar()
        }}
        onResize={(size) => {
          ctx.onSidebarResize(size)
        }}
        onExpand={() => {
          console.log('=== Sidebar onExpand call')

          ctx.onLockSidebarOpen()
        }}
      >
        <YStack
          bg={isDark ? '$backgroundStrong' : '$background'}
          borderWidth={isLocked ? undefined : 1}
          borderColor={isLocked ? undefined : '$color7'}
          animation="fast"
          position={isLocked ? 'relative' : 'absolute'}
          zi={isLocked ? undefined : '$zIndex.9'}
          x={isVisible ? 0 : -SidebarWidth}
          width="100%"
          maxWidth={isLocked ? undefined : SidebarWidth}
          elevation={isLocked ? undefined : '$4'}
          top={isLocked ? undefined : 8}
          bottom={isLocked ? undefined : 8}
          borderTopRightRadius={!isLocked ? '$3' : undefined}
          borderBottomRightRadius={!isLocked ? '$3' : undefined}
          onMouseEnter={ctx.onMenuHover}
          onMouseLeave={ctx.onMenuHoverLeave}
          opacity={isVisible ? 1 : 0}
          h="100%"
        >
          <YStack
            flex={1}
            // @ts-expect-error why does Tamagui/TS not agree that this is an acceptable value? IT WORKS!
            overflow="auto"
            p={10}
          >
            {children}
          </YStack>
          <XStack padding="$2" jc="space-between">
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
          </XStack>
        </YStack>
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

type DocOutlineSection = {
  title: string
  id: string
  entityId?: UnpackedHypermediaId
  parentBlockId?: string
  children?: DocOutlineSection[]
  icon?: FC<ComponentProps<typeof Hash>>
}

export function SidebarDivider() {
  return <Separator marginVertical="$2" />
}
