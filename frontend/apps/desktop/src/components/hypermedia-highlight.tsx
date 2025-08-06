import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useEffect, useRef} from 'react'

// Default highlight color - adjust as needed
const DEFAULT_HIGHLIGHT_COLOR = 'var(--accent)' // Light gold with transparency

interface HypermediaHighlightProps {
  /** Optional custom highlight color */
  highlightColor?: string
}

/**
 * Component that manages highlighting elements with specific hypermedia IDs
 * across all windows in the Electron application.
 */
export function HypermediaHighlight({
  highlightColor = DEFAULT_HIGHLIGHT_COLOR,
}: HypermediaHighlightProps) {
  const styleRef = useRef<HTMLStyleElement | null>(null)

  // Create the style element on mount
  useEffect(() => {
    if (!styleRef.current) {
      const styleEl = document.createElement('style')
      styleEl.id = 'hypermedia-hover-styles'
      document.head.appendChild(styleEl)
      styleRef.current = styleEl
    }

    // Clean up the style element on unmount
    return () => {
      if (styleRef.current) {
        document.head.removeChild(styleRef.current)
        styleRef.current = null
      }
    }
  }, [])

  // Create CSS for highlighting elements with the specified hypermedia ID
  function createHighlightCSS(id: UnpackedHypermediaId): string {
    const selectors = []

    if (id.uid) {
      if (id.blockRef) {
        selectors.push(`[data-blockid="${id.blockRef}"]`)
      } else {
        selectors.push(`[data-docid="${id.id}"]`)
      }
    }

    const textHighlightSelectors = selectors
      .map(
        (selector) =>
          `${selector}.block-paragraph span, ${selector}.block-paragraph strong, ${selector}.block-paragraph em, ${selector}.block-paragraph a, ${selector}.block-paragraph code, ${selector}.block-heading span, ${selector}.block-heading strong, ${selector}.block-heading em, ${selector}.block-heading a, ${selector}.block-heading code`,
      )
      .join(',')

    const blockHighlightSelectors = selectors
      .map(
        (selector) => `${selector}:not(.block-paragraph):not(.block-heading)`,
      )
      .join(',')

    return `
      ${textHighlightSelectors} {
        transition: background-color 0.3s ease;
        background-color: ${highlightColor} !important;
      }
      ${blockHighlightSelectors} {
        transition: background-color 0.3s ease;
        background-color: ${highlightColor} !important;
      }
    `
  }

  // Listen for hypermedia hover events
  useEffect(() => {
    // @ts-ignore - window.appWindowEvents might not be defined in types
    const unsubscribe = window.appWindowEvents?.subscribe((event: any) => {
      if (!styleRef.current) return
      if (typeof event === 'object') {
        if (event.key === 'hypermediaHoverIn' && event.id) {
          styleRef.current.textContent = createHighlightCSS(event.id)
        } else if (event.key === 'hypermediaHoverOut') {
          styleRef.current.textContent = ''
        }
      }
    })

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [highlightColor])

  // This component doesn't render anything visible
  return null
}
