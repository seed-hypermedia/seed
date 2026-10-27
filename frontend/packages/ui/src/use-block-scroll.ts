import {useCallback, useEffect, useLayoutEffect, useRef} from 'react'

// Use useLayoutEffect on client, useEffect on server (SSR safe)
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/** Controls source-block scrolling and repeated navigation to the same block. */
export type BlockScrollOptions = {
  /** Block position when scrolling ('start' | 'center') */
  block?: ScrollLogicalPosition
  /** Scroll behavior ('smooth' | 'instant') */
  behavior?: ScrollBehavior
  /** A new navigation can select the same block after the reader has scrolled away. */
  navigationKey?: unknown
}

// Breathing room above the target block. Nothing is pinned over the scroll
// container anymore, so this only keeps the block off the very top edge.
const SCROLL_TOP_MARGIN = 16

/**
 * Height the document top bar covers when it is pinned over the scrolling
 * document, which only happens on mobile web where the document itself scrolls.
 */
function pinnedTopBarHeight(): number {
  const bar = document.querySelector<HTMLElement>('[data-document-top-bar]')
  if (!bar || window.getComputedStyle(bar).position !== 'sticky') return 0
  return bar.getBoundingClientRect().height
}

/** Scrolls the window so the element clears both the pinned top bar and the top edge. */
function scrollWindowToElement(element: HTMLElement, behavior: ScrollBehavior | undefined) {
  const top = element.getBoundingClientRect().top + window.scrollY - SCROLL_TOP_MARGIN - pinnedTopBarHeight()
  window.scrollTo({top: Math.max(top, 0), behavior})
}

/** Finds the source block without selecting a quoted copy inside an embed. */
function findSourceBlock(blockId: string): HTMLElement | null {
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[data-node-type="blockNode"][data-id]'))) {
    if (element.dataset.id === blockId && !element.closest('[data-content-type="embed"]')) return element
  }
  return document.getElementById(blockId)
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
export function useBlockScroll(blockRef: string | null | undefined, options: BlockScrollOptions = {}) {
  const {block, behavior, navigationKey} = {...defaultOptions, ...options}
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
      const element = findSourceBlock(blockRef)
      if (!element) return false

      // Find the scrollable ancestor container (for nested scroll containers like on web)
      let scrollContainer: HTMLElement | null = null
      let parent = element.parentElement
      while (parent) {
        const style = window.getComputedStyle(parent)
        const overflowY = style.overflowY
        if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
          scrollContainer = parent
          break
        }
        parent = parent.parentElement
      }

      if (scrollContainer) {
        // Scroll the container directly
        const containerRect = scrollContainer.getBoundingClientRect()
        const elementRect = element.getBoundingClientRect()
        const scrollTop = scrollContainer.scrollTop + elementRect.top - containerRect.top - SCROLL_TOP_MARGIN
        scrollContainer.scrollTo({top: scrollTop, behavior})
      } else if (block === 'start') {
        scrollWindowToElement(element, behavior)
      } else {
        element.scrollIntoView({behavior, block})
      }
      return true
    }

    // The editor may mount after the route. Observe its arrival instead of
    // stopping after a fixed retry window on slow documents.
    const observer = new MutationObserver(() => {
      if (scrollToElement()) observer.disconnect()
    })
    const rafId = requestAnimationFrame(() => {
      if (!scrollToElement()) observer.observe(document.body, {childList: true, subtree: true})
    })
    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [blockRef, behavior, block, navigationKey])

  // Call this when manually scrolling to prevent double-scroll from effect
  const scrollToBlock = useCallback(
    (blockId: string) => {
      lastScrolledBlockRef.current = blockId
      const element = findSourceBlock(blockId)
      if (!element) return

      // Find the scrollable ancestor container
      let scrollContainer: HTMLElement | null = null
      let parent = element.parentElement
      while (parent) {
        const style = window.getComputedStyle(parent)
        const overflowY = style.overflowY
        if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
          scrollContainer = parent
          break
        }
        parent = parent.parentElement
      }

      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect()
        const elementRect = element.getBoundingClientRect()
        const scrollTop = scrollContainer.scrollTop + elementRect.top - containerRect.top - SCROLL_TOP_MARGIN
        scrollContainer.scrollTo({top: scrollTop, behavior})
      } else if (block === 'start') {
        scrollWindowToElement(element, behavior)
      } else {
        element.scrollIntoView({behavior, block})
      }
    },
    [behavior, block],
  )

  return {scrollToBlock}
}
