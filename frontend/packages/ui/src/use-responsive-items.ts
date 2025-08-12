import {useCallback, useEffect, useRef, useState} from 'react'

// Default width estimator - stable reference
const defaultGetItemWidth = () => 150

/**
 * Custom hook for responsive overflow behavior
 * Automatically moves items to an overflow state when they don't fit in the container
 */
export function useResponsiveItems<T extends {key: string}>({
  items,
  activeKey,
  getItemWidth = defaultGetItemWidth,
  reservedWidth = 0,
  gapWidth = 20,
}: {
  items: T[]
  activeKey?: string
  getItemWidth?: (item: T) => number
  reservedWidth?: number
  gapWidth?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map())
  const [visibleItems, setVisibleItems] = useState<T[]>([])
  const [overflowItems, setOverflowItems] = useState<T[]>([])
  const updateTimeoutRef = useRef<NodeJS.Timeout>()

  // Calculate which items fit in the available space
  const updateVisibility = useCallback(() => {
    if (!containerRef.current || !items?.length) {
      setVisibleItems([])
      setOverflowItems([])
      return
    }

    const container = containerRef.current
    const containerWidth = container.getBoundingClientRect().width

    // Skip if container has no width (e.g., hidden)
    if (containerWidth === 0) {
      return
    }

    const availableWidth = containerWidth - reservedWidth

    const visible: T[] = []
    const overflow: T[] = []

    // Create array of items with their measured widths
    const itemWidths: Array<{item: T; width: number; isActive: boolean}> = []

    for (const item of items) {
      const element = itemRefs.current.get(item.key)
      const isActive = activeKey === item.key
      if (element) {
        const width = element.getBoundingClientRect().width + gapWidth
        itemWidths.push({item, width, isActive})
      } else {
        // If we can't measure, use the provided estimate
        itemWidths.push({item, width: getItemWidth(item), isActive})
      }
    }

    // Find the active item and reserve space for it first
    const activeItemData = itemWidths.find(({isActive}) => isActive)
    let remainingWidth = availableWidth

    if (activeItemData) {
      remainingWidth -= activeItemData.width
    }

    // Now go through items in original order and add them if they fit
    for (const {item, width, isActive} of itemWidths) {
      if (isActive) {
        // Always include the active item (space already reserved)
        visible.push(item)
      } else {
        // For non-active items, only add if there's remaining space
        if (width <= remainingWidth) {
          visible.push(item)
          remainingWidth -= width
        } else {
          overflow.push(item)
        }
      }
    }

    // Ensure we show at least one item (fallback)
    if (visible.length === 0 && items.length > 0) {
      // @ts-ignore
      visible.push(items[0])
      const firstOverflowIndex = overflow.findIndex(
        // @ts-ignore
        (item) => item.key === items[0].key,
      )
      if (firstOverflowIndex !== -1) {
        overflow.splice(firstOverflowIndex, 1)
      }
    }

    setVisibleItems(visible)
    setOverflowItems(overflow)
  }, [items, activeKey, getItemWidth, reservedWidth, gapWidth])

  // Debounced version of updateVisibility
  const debouncedUpdateVisibility = useCallback(() => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current)
    }

    updateTimeoutRef.current = setTimeout(() => {
      updateVisibility()
    }, 16) // ~60fps
  }, [updateVisibility])

  // Update visibility when items change
  useEffect(() => {
    updateVisibility()

    // Second update after render to ensure accurate measurements
    const timer = setTimeout(() => {
      updateVisibility()
    }, 100)

    return () => {
      clearTimeout(timer)
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
      }
    }
  }, [updateVisibility])

  // Setup resize observer
  useEffect(() => {
    if (!containerRef.current) return

    const observer = new ResizeObserver(() => {
      debouncedUpdateVisibility()
    })

    observer.observe(containerRef.current)

    const handleResize = () => {
      debouncedUpdateVisibility()
    }

    window.addEventListener('resize', handleResize)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', handleResize)
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
      }
    }
  }, [debouncedUpdateVisibility])

  return {
    containerRef,
    itemRefs,
    visibleItems,
    overflowItems,
  }
}
