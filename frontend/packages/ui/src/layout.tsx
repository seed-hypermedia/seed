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

export const widthValues = {
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

  // Initialize with default content width instead of 0
  const initialWidth = useMemo(() => {
    // Make sure we have a valid width even before the element is available
    const configWidth = config.contentWidth
    if (configWidth === 'S') return widthValues.S
    if (configWidth === 'M') return widthValues.M
    if (configWidth === 'L') return widthValues.L
    return widthValues.M
  }, [config.contentWidth])
  const [widthState, setWidthState] = useState(initialWidth)

  useIsomorphicLayoutEffect(() => {
    // Check if we're in a browser environment
    if (typeof window === 'undefined') {
      console.log('useDocumentLayout: window undefined, skipping effect')
      return
    }

    let element = elementRef.current

    // Always set initial width, even if element isn't available yet
    if (!element) {
      const initialWidth = getContentWidth(config.contentWidth) || 0
      console.log(
        'useDocumentLayout: no element, setting initial width:',
        initialWidth,
      )
      setWidthState(initialWidth)
    } else {
      const width = element.getBoundingClientRect().width
      setWidthState(width)
    }

    // Create ResizeObserver to track element size changes
    const resizeObserver = new ResizeObserver((entries) => {
      const observedElement = entries[0]
      if (observedElement) {
        const newWidth = observedElement.contentRect.width
        setWidthState(newWidth)
      }
    })

    // Set up mutation observer to detect when the element is added to the DOM
    const mutationObserver = new MutationObserver((mutations) => {
      if (elementRef.current && !element) {
        element = elementRef.current

        // Observe the newly found element
        resizeObserver.observe(element)

        // Get initial dimensions
        const initialWidth = element.getBoundingClientRect().width

        setWidthState(initialWidth)

        // Once we find the element, no need to continue observing mutations
        mutationObserver.disconnect()
      }
    })

    // Start observing the document for mutations
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    })

    // If element is already available, start observing it immediately
    if (element) {
      resizeObserver.observe(element)
    }

    return () => {
      // Clean up both observers
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [config.contentWidth, config.showSidebars])

  const contentMaxWidth = useMemo(
    () => getContentWidth(config.contentWidth),
    [config.contentWidth],
  )

  // Calculate properties based on current width
  const showSidebars = useMemo(
    () => config.showSidebars && widthState > contentMaxWidth + 100,
    [config.showSidebars, widthState, contentMaxWidth],
  )
  const showCollapsed = useMemo(
    () => widthState < contentMaxWidth + 700,
    [widthState, contentMaxWidth],
  )

  // Get default value for fallbacks to avoid TypeScript errors
  const defaultMaxWidth = useMemo(() => contentMaxWidth.M, [])

  return {
    elementRef,
    width: widthState,

    showSidebars: showSidebars || false,
    showCollapsed: showCollapsed || false,
    contentMaxWidth: contentMaxWidth || defaultMaxWidth,
    sidebarProps: {
      maxWidth: showCollapsed ? 40 : 280,
      flex: 1,
      paddingRight: showCollapsed ? 0 : 40,
      className: 'document-aside',
      width: '100%',
    },
    mainContentProps: {
      maxWidth: contentMaxWidth || defaultMaxWidth,
      width: '100%',
    },
    wrapperProps: {
      maxWidth:
        (contentMaxWidth || defaultMaxWidth) +
        (showSidebars && config.showSidebars ? (showCollapsed ? 100 : 700) : 0),
      marginHorizontal: 'auto',
      width: '100%',
      justifyContent: 'space-between',
      flex: 1,
    } as XStackProps,
  }
}

function getContentWidth(contentWidth: HMMetadata['contentWidth']) {
  if (contentWidth === 'S') return widthValues.S
  if (contentWidth === 'M') return widthValues.M
  if (contentWidth === 'L') return widthValues.L
  return widthValues.M
}
