import {setHypermediaHover} from '@shm/ui/highlight-context'
import {useEffect} from 'react'

interface HypermediaHighlightProps {
  /** Optional custom highlight color. */
  highlightColor?: string
}

/** Applies shared hover highlighting to events broadcast from other desktop windows. */
export function HypermediaHighlight({highlightColor = 'var(--highlight)'}: HypermediaHighlightProps) {
  useEffect(() => {
    const unsubscribe = window.appWindowEvents?.subscribe((event: any) => {
      if (event?.type === 'hypermediaHoverIn' && event.id) {
        setHypermediaHover(event.id, highlightColor)
      } else if (event?.type === 'hypermediaHoverOut') {
        setHypermediaHover(null)
      }
    })
    return () => {
      unsubscribe?.()
      setHypermediaHover(null)
    }
  }, [highlightColor])
  return null
}
