import {HMMetadata} from '@shm/shared'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {forwardRef, useMemo, useRef, useState} from 'react'
import {ScrollView, XStackProps, YStack, YStackProps} from 'tamagui'

export const MainWrapper = forwardRef<any, YStackProps & {noScroll?: boolean}>(
  function MainWrapper({children, noScroll = false, ...props}, ref) {
    return (
      <YStack flex={1} className="content-wrapper" {...props} ref={ref}>
        {noScroll ? (
          children
        ) : (
          // TODO: we cannot remove this ID here because the SlashMenu is referencing this!
          <ScrollView id="scroll-page-wrapper">{children}</ScrollView>
        )}
      </YStack>
    )
  },
)

export type LayoutMode = 'mobile' | 'tablet' | 'desktop'
export type BreakpointConfig = {
  mobileBreakpoint: number
  tabletBreakpoint: number
}

export const contentMaxWidth = {
  S: 600,
  M: 700,
  L: 900,
}

export const useDocumentLayout = (
  config: Partial<
    BreakpointConfig & {
      contentWidth: HMMetadata['contentWidth']
      showSidebars: boolean
    }
  > = {},
) => {
  // Always call hooks in the same order
  const elementRef = useRef<HTMLDivElement>(null)
  // Use useState (not useRef) to trigger re-renders when width changes
  const [widthState, setWidthState] = useState(0)

  useIsomorphicLayoutEffect(() => {
    // Check if we're in a browser environment
    if (typeof window === 'undefined') return

    const element = elementRef.current
    if (!element) return

    handleResize()

    function handleResize() {
      if (!element) {
        setWidthState(getContentWidth(config.contentWidth) || 0)
      } else {
        setWidthState(element.getBoundingClientRect().width)
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  const contentMaxWidth = useMemo(
    () => getContentWidth(config.contentWidth),
    [config.contentWidth],
  )

  // Calculate properties based on current width
  const showSidebars = config.showSidebars && widthState > contentMaxWidth + 100
  const showCollapsed = widthState < contentMaxWidth + 700

  return {
    elementRef,
    width: widthState,

    showSidebars,
    showCollapsed,
    contentMaxWidth,
    sidebarProps: {
      maxWidth: showCollapsed ? 40 : 280,
      flex: 1,
      paddingRight: showCollapsed ? 0 : 40,
      className: 'document-aside',
      width: '100%',
    },
    mainContentProps: {
      maxWidth: contentMaxWidth,
      width: '100%',
    },
    wrapperProps: {
      maxWidth:
        contentMaxWidth +
        (showSidebars && config.showSidebars ? (showCollapsed ? 100 : 700) : 0),
      marginHorizontal: 'auto',
      width: '100%',
      justifyContent: 'space-between',
      flex: 1,
    } as XStackProps,
  }
}

function getContentWidth(contentWidth: HMMetadata['contentWidth']) {
  if (contentWidth === 'S') return contentMaxWidth.S
  if (contentWidth === 'M') return contentMaxWidth.M
  if (contentWidth === 'L') return contentMaxWidth.L
  return contentMaxWidth.M
}
