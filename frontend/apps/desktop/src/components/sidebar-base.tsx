import {useAppContext} from '@/app-context'
import {EmbedsContent} from '@/models/documents'
import {SidebarWidth, useSidebarContext} from '@/sidebar-context'
import {useNavigate} from '@/utils/useNavigate'
import {NavRoute, UnpackedHypermediaId} from '@shm/shared'
import {
  Button,
  FocusButton,
  Separator,
  Tooltip,
  useStream,
  View,
  XStack,
  YStack,
} from '@shm/ui'
import {SmallListGroupItem} from '@shm/ui/src'
import {Hash, Settings} from '@tamagui/lucide-icons'
import {ComponentProps, FC, ReactNode, useEffect, useState} from 'react'

const HoverRegionWidth = 30

export function GenericSidebarContainer({children}: {children: ReactNode}) {
  const ctx = useSidebarContext()
  const isFocused = useIsWindowFocused({
    onBlur: () => ctx.onMenuHoverLeave(),
  })
  const isWindowTooNarrowForHoverSidebar = useIsWindowNarrowForHoverSidebar()
  const isLocked = useStream(ctx.isLocked)
  const isHoverVisible = useStream(ctx.isHoverVisible)
  const isVisible = isLocked || isHoverVisible
  const {platform} = useAppContext()
  let top = platform === 'darwin' ? 40 : 64
  let bottom = 24
  if (!isLocked) {
    top += 8
    bottom += 8
  }
  const navigate = useNavigate()
  return (
    <>
      {isFocused && !isLocked && !isWindowTooNarrowForHoverSidebar ? (
        <YStack
          position="absolute"
          left={-20} // this -20 is to make sure the rounded radius is not visible on the edge
          borderRadius={'$3'}
          bg="$backgroundStrong"
          width={HoverRegionWidth + 20} // this 20 is to make sure the rounded radius is not visible on the edge
          top={top}
          zi="$zIndex.7"
          opacity={0}
          hoverStyle={{
            opacity: 0.1,
          }}
          bottom={bottom}
          onMouseEnter={ctx.onMenuHoverDelayed}
          onMouseLeave={ctx.onMenuHoverLeave}
          onPress={ctx.onMenuHover}
        />
      ) : null}
      <YStack
        bg="$backgroundStrong"
        borderRightWidth={1}
        borderColor={'$color4'}
        animation="fast"
        position="absolute"
        zi="$zIndex.7"
        x={isVisible ? 0 : -SidebarWidth}
        width="100%"
        maxWidth={SidebarWidth}
        elevation={!isLocked ? '$4' : undefined}
        top={top}
        bottom={bottom}
        borderTopRightRadius={!isLocked ? '$3' : undefined}
        borderBottomRightRadius={!isLocked ? '$3' : undefined}
        onMouseEnter={ctx.onMenuHover}
        onMouseLeave={ctx.onMenuHoverLeave}
        opacity={isVisible ? 1 : 0}
      >
        <YStack
          flex={1}
          overflow="auto" // why does Tamagui/TS not agree that this is an acceptable value? IT WORKS!
          // paddingVertical="$2"
          p={10}
        >
          {children}
        </YStack>
        <XStack
          padding="$2"
          jc="space-between"
          borderTopWidth={1}
          borderColor="$borderColor"
        >
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

export function activeDocOutline(
  outline: DocOutlineSection[],
  activeBlock: string | null | undefined,
  focusBlock: string | null | undefined,
  embeds: EmbedsContent,
  onBlockSelect: (
    blockId: string,
    entityId: UnpackedHypermediaId | undefined,
    parentBlockId: string | undefined,
  ) => void,
  onBlockFocus: (
    blockId: string,
    entityId: UnpackedHypermediaId | undefined,
    parentBlockId: string | undefined,
  ) => void,
  onNavigate: (route: NavRoute) => void,
  level = 0,
): {
  outlineContent: ReactNode[]
  isBlockActive: boolean
  isBlockFocused: boolean
} {
  let isBlockActive = false
  let isBlockFocused = false
  const outlineContent = outline.map((item) => {
    const childrenOutline = item.children
      ? activeDocOutline(
          item.children,
          activeBlock,
          focusBlock,
          embeds,
          onBlockSelect,
          onBlockFocus,
          onNavigate,
          level + 1,
        )
      : null
    if (childrenOutline?.isBlockActive) {
      isBlockActive = true
    } else if (item.id === activeBlock) {
      isBlockActive = true
    }
    if (childrenOutline?.isBlockFocused) {
      isBlockFocused = true
    } else if (item.id === focusBlock) {
      isBlockFocused = true
    }
    return (
      <SmallListGroupItem
        onPress={() => {
          onBlockSelect(item.id, item.entityId, item.parentBlockId)
        }}
        active={item.id === activeBlock || item.id === focusBlock}
        activeBgColor={item.id === activeBlock ? '$brand12' : undefined}
        icon={
          <View width={16}>
            {item.icon ? (
              <item.icon color="$color9" size={16} />
            ) : (
              <Hash color="$color9" size={16} />
            )}
          </View>
        }
        title={item.title || 'Untitled Heading'}
        indented={2 + level}
        items={childrenOutline?.outlineContent || []}
        rightHover={[
          <FocusButton
            key="focus"
            onPress={() => {
              onBlockFocus(item.id, item.entityId, item.parentBlockId)
            }}
          />,
        ]}
        defaultExpanded
      />
    )
  })
  return {outlineContent, isBlockActive, isBlockFocused}
}

export function SidebarDivider() {
  return <Separator marginVertical="$2" />
}
