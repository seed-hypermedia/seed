import {useCallback, useEffect, useRef, useState} from 'react'

/**
 * Pins a chat scroll view to the bottom as its content grows — streamed text, live tool
 * output, expanding rows, anything that changes content height — unless the user has
 * scrolled up, in which case a "jump to bottom" button is shown instead.
 *
 * Growth is tracked with a ResizeObserver on the content element, so it covers every
 * source of height change, not just new rows. Attach `containerRef`/`contentRef` to the
 * scroll container and its inner content element, and `handleScroll` to the container.
 */
export function useChatAutoScroll() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const isNearBottomRef = useRef(true)
  const scrollingToBottomRef = useRef(false)

  const contentRef = useCallback((element: HTMLDivElement | null) => {
    setContentEl(element)
  }, [])

  const checkIsNearBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return true
    return container.scrollHeight - container.scrollTop - container.clientHeight <= 100
  }, [])

  const setNearBottom = useCallback((nearBottom: boolean) => {
    isNearBottomRef.current = nearBottom
    setIsNearBottom(nearBottom)
    setShowScrollButton(!nearBottom)
  }, [])

  const handleScroll = useCallback(() => {
    const nearBottom = checkIsNearBottom()
    if (scrollingToBottomRef.current) {
      // Ignore intermediate positions during an animated scroll to the bottom.
      if (nearBottom) {
        scrollingToBottomRef.current = false
        setNearBottom(true)
      }
      return
    }
    setNearBottom(nearBottom)
  }, [checkIsNearBottom, setNearBottom])

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    scrollingToBottomRef.current = true
    setNearBottom(true)
    container.scrollTo({top: container.scrollHeight, behavior: 'smooth'})
  }, [setNearBottom])

  /** Instantly jumps to the bottom and re-pins; use when switching conversations. */
  const resetToBottom = useCallback(() => {
    setNearBottom(true)
    requestAnimationFrame(() => {
      const container = containerRef.current
      if (container) container.scrollTop = container.scrollHeight
    })
  }, [setNearBottom])

  // Content growth while pinned keeps the view at the bottom. When scrolled up, the
  // jump button is already visible from the scroll handler.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !contentEl) return
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) container.scrollTop = container.scrollHeight
    })
    observer.observe(contentEl)
    return () => observer.disconnect()
  }, [contentEl])

  return {containerRef, contentRef, isNearBottom, showScrollButton, handleScroll, scrollToBottom, resetToBottom}
}
