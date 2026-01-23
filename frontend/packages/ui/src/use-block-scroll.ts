import {useCallback, useEffect, useLayoutEffect, useRef} from 'react'

// Use useLayoutEffect on client, useEffect on server (SSR safe)
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

export type BlockScrollOptions = {
  /** Block position when scrolling ('start' | 'center') */
  block?: ScrollLogicalPosition
  /** Scroll behavior ('smooth' | 'instant') */
  behavior?: ScrollBehavior
}

const defaultOptions: BlockScrollOptions = {
  block: 'start',
  behavior: 'smooth',
}

/**
 * Hook for scrolling to blocks with deduplication to prevent double-scrolling.
 *
 * Handles two scenarios:
 * 1. Manual scroll (user clicks block/outline) - call scrollToBlock()
 * 2. Route-based scroll (URL blockRef changes) - handled by useEffect
 *
 * The lastScrolledBlockRef pattern prevents the useEffect from
 * re-scrolling when the URL updates after a manual scroll.
 *
 * @example
 * // In document page component
 * const {scrollToBlock} = useBlockScroll(blockRef)
 *
 * // When user clicks outline item
 * const onActivateBlock = (blockId: string) => {
 *   scrollToBlock(blockId)
 *   navigate({...route, id: {...id, blockRef: blockId}})
 * }
 */
export function useBlockScroll(
  blockRef: string | null | undefined,
  options: BlockScrollOptions = {},
) {
  const {block, behavior} = {...defaultOptions, ...options}
  const lastScrolledBlockRef = useRef<string | null>(null)

  // Scroll to blockRef when it changes via URL (e.g., clicking embed in panel, initial load)
  // Skip if we just scrolled manually via scrollToBlock to avoid double scroll
  // Use layout effect to run as early as possible
  useIsomorphicLayoutEffect(() => {
    if (!blockRef || blockRef === lastScrolledBlockRef.current) {
      lastScrolledBlockRef.current = null
      return
    }

    const scrollToElement = () => {
      const element = document.getElementById(blockRef)
      if (!element) return false

      // Find the scrollable ancestor container (for nested scroll containers like on web)
      let scrollContainer: HTMLElement | null = null
      let parent = element.parentElement
      while (parent) {
        const style = window.getComputedStyle(parent)
        const overflowY = style.overflowY
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          parent.scrollHeight > parent.clientHeight
        ) {
          scrollContainer = parent
          break
        }
        parent = parent.parentElement
      }

      if (scrollContainer) {
        // Scroll the container directly
        const containerRect = scrollContainer.getBoundingClientRect()
        const elementRect = element.getBoundingClientRect()
        const scrollTop =
          scrollContainer.scrollTop + elementRect.top - containerRect.top
        scrollContainer.scrollTo({top: scrollTop, behavior})
      } else {
        // No scroll container, use standard scrollIntoView
        element.scrollIntoView({behavior, block})
      }
      return true
    }

    // Don't try immediately - wait for scroll containers to be created
    // The scroll container (overflow-y-auto) may not exist yet during SSR hydration
    // Use requestAnimationFrame to wait for the next paint, then retry with timeouts
    let retryCount = 0
    const maxRetries = 20
    const retryDelay = 50

    const retry = () => {
      if (scrollToElement() || retryCount >= maxRetries) {
        lastScrolledBlockRef.current = null
        return
      }
      retryCount++
      timeoutId = setTimeout(retry, retryDelay)
    }

    // Wait for next frame to allow scroll containers to be created
    let rafId = requestAnimationFrame(() => {
      timeoutId = setTimeout(retry, 0)
    })

    let timeoutId: ReturnType<typeof setTimeout>
    return () => {
      cancelAnimationFrame(rafId)
      clearTimeout(timeoutId)
    }
  }, [blockRef, behavior, block])

  // Call this when manually scrolling to prevent double-scroll from effect
  const scrollToBlock = useCallback(
    (blockId: string) => {
      lastScrolledBlockRef.current = blockId
      const element = document.getElementById(blockId)
      if (!element) return

      // Find the scrollable ancestor container
      let scrollContainer: HTMLElement | null = null
      let parent = element.parentElement
      while (parent) {
        const style = window.getComputedStyle(parent)
        const overflowY = style.overflowY
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          parent.scrollHeight > parent.clientHeight
        ) {
          scrollContainer = parent
          break
        }
        parent = parent.parentElement
      }

      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect()
        const elementRect = element.getBoundingClientRect()
        const scrollTop =
          scrollContainer.scrollTop + elementRect.top - containerRect.top
        scrollContainer.scrollTo({top: scrollTop, behavior})
      } else {
        element.scrollIntoView({behavior, block})
      }
    },
    [behavior, block],
  )

  return {scrollToBlock}
}
