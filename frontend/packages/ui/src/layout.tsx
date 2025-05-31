import {HMMetadata} from '@shm/shared'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {forwardRef, useMemo, useRef, useState} from 'react'
import {ScrollView, useMedia, YStack, YStackProps} from 'tamagui'

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
  const media = useMedia()

  // Get content width configuration
  const contentMaxWidth = useMemo(
    () => getContentWidth(config.contentWidth),
    [config.contentWidth],
  )

  // State for layout booleans - only updates when crossing breakpoints
  const [layoutState, setLayoutState] = useState(() => {
    // Initialize with reasonable defaults based on config
    const initialShowSidebars = false // Will be corrected by ResizeObserver
    const initialShowCollapsed = true // Will be corrected by ResizeObserver

    return {
      showSidebars: initialShowSidebars,
      showCollapsed: initialShowCollapsed,
    }
  })

  // Keep current width in ref for performance (no re-renders on every pixel change)
  const currentWidthRef = useRef<number>(contentMaxWidth)

  useIsomorphicLayoutEffect(() => {
    // Check if we're in a browser environment
    if (typeof window === 'undefined') {
      console.log('useDocumentLayout: window undefined, skipping effect')
      return
    }

    let element = elementRef.current

    // Function to calculate and update layout if needed
    const updateLayoutIfNeeded = (width: number) => {
      currentWidthRef.current = width

      const newShowSidebars = Boolean(
        config.showSidebars && width > contentMaxWidth + 100,
      )
      const newShowCollapsed = width < contentMaxWidth + 700

      // Only update state if layout actually changed (crossing breakpoints)
      setLayoutState((prevState) => {
        if (
          prevState.showSidebars !== newShowSidebars ||
          prevState.showCollapsed !== newShowCollapsed
        ) {
          return {
            showSidebars: newShowSidebars,
            showCollapsed: newShowCollapsed,
          }
        }
        return prevState // No change, don't trigger re-render
      })
    }

    // Set initial width if element exists
    if (element) {
      const initialWidth = element.getBoundingClientRect().width
      updateLayoutIfNeeded(initialWidth)
    }

    // Create ResizeObserver to track element size changes
    const resizeObserver = new ResizeObserver((entries) => {
      const observedElement = entries[0]
      if (observedElement) {
        const newWidth = observedElement.contentRect.width
        updateLayoutIfNeeded(newWidth)
      }
    })

    // Set up mutation observer to detect when the element is added to the DOM
    const mutationObserver = new MutationObserver((mutations) => {
      if (elementRef.current && !element) {
        element = elementRef.current

        // Observe the newly found element
        resizeObserver.observe(element)

        // Get initial dimensions and update layout
        const initialWidth = element.getBoundingClientRect().width
        updateLayoutIfNeeded(initialWidth)

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
  }, [config.contentWidth, config.showSidebars, contentMaxWidth])

  // Return layout properties - now properly reactive to state changes
  return useMemo(
    () => ({
      elementRef,
      width: currentWidthRef,

      showSidebars: layoutState.showSidebars,
      showCollapsed: layoutState.showCollapsed,
      contentMaxWidth,
      sidebarProps: {
        className: `document-aside flex-1 w-full ${
          layoutState.showCollapsed ? 'pr-0' : 'pr-10'
        }`,
        style: {
          maxWidth: layoutState.showCollapsed ? 40 : 280,
        },
      },
      mainContentProps: {
        className: 'w-full',
        style: {
          maxWidth: contentMaxWidth,
        },
      },
      wrapperProps: {
        className: 'mx-auto w-full justify-between flex-1',
        style: {
          maxWidth:
            contentMaxWidth +
            (layoutState.showSidebars && config.showSidebars
              ? layoutState.showCollapsed
                ? 100
                : 700
              : 0) +
            /**
             * this is added because we are showing the comment and citations button
             * on the right of each block. in the future we might expand
             * the block content to also have more space so we can render marginalia.
             **/
            (media.gtSm ? 44 : 0),
        },
      },
    }),
    [
      layoutState.showSidebars,
      layoutState.showCollapsed,
      contentMaxWidth,
      config.showSidebars,
      media.gtSm,
    ],
  )
}

function getContentWidth(contentWidth: HMMetadata['contentWidth']) {
  if (contentWidth === 'S') return widthValues.S
  if (contentWidth === 'M') return widthValues.M
  if (contentWidth === 'L') return widthValues.L
  return widthValues.M
}
