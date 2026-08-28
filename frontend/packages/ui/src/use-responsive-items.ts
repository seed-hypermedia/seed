import {useCallback, useEffect, useRef, useState} from 'react'

// Default width estimator - stable reference
const defaultGetItemWidth = () => 150

/** Splits responsive items into ordered visible and overflow collections. */
export function splitResponsiveItems<T extends {key: string}>({
  items,
  activeKey,
  containerWidth,
  reservedWidth = 0,
  overflowTriggerWidth = 32,
  getWidth,
}: {
  items: T[]
  activeKey?: string
  containerWidth: number
  reservedWidth?: number
  overflowTriggerWidth?: number
  getWidth: (item: T) => number
}) {
  const widths = items.map((item) => ({item, width: getWidth(item)}))
  const availableWidth = Math.max(0, containerWidth - reservedWidth)
  const needsOverflow = widths.reduce((total, entry) => total + entry.width, 0) > availableWidth
  let remainingWidth = availableWidth - (needsOverflow ? overflowTriggerWidth : 0)
  const visibleKeys = new Set<string>()
  const activeEntry = widths.find(({item}) => item.key === activeKey)

  if (activeEntry) {
    visibleKeys.add(activeEntry.item.key)
    remainingWidth -= activeEntry.width
  }
  for (const {item, width} of widths) {
    if (visibleKeys.has(item.key)) continue
    if (width <= remainingWidth) {
      visibleKeys.add(item.key)
      remainingWidth -= width
    }
  }
  if (visibleKeys.size === 0 && items[0]) visibleKeys.add(items[0].key)

  return {
    visibleItems: items.filter((item) => visibleKeys.has(item.key)),
    overflowItems: items.filter((item) => !visibleKeys.has(item.key)),
  }
}

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
  // null = not measured yet, show all items (SSR)
  const [measuredVisible, setMeasuredVisible] = useState<T[] | null>(null)
  const [overflowItems, setOverflowItems] = useState<T[]>([])
  const updateTimeoutRef = useRef<NodeJS.Timeout>()

  // Calculate which items fit in the available space
  const updateVisibility = useCallback(() => {
    // Don't set measuredVisible when container isn't ready - keep showing all items
    if (!containerRef.current) return
    if (!items?.length) {
      setMeasuredVisible([])
      setOverflowItems([])
      return
    }

    const container = containerRef.current
    const containerWidth = container.getBoundingClientRect().width

    // Skip if container has no width (e.g., hidden)
    if (containerWidth === 0) {
      return
    }

    const result = splitResponsiveItems({
      items,
      activeKey,
      containerWidth,
      reservedWidth,
      getWidth: (item) => {
        const element = itemRefs.current.get(item.key)
        return element ? element.getBoundingClientRect().width + gapWidth : getItemWidth(item)
      },
    })

    setMeasuredVisible(result.visibleItems)
    setOverflowItems(result.overflowItems)
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
    // Before measurement, show all items (SSR-friendly)
    visibleItems: measuredVisible ?? items,
    overflowItems,
  }
}
