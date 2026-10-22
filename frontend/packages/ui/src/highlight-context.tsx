import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'

import {useUniversalAppContext} from '@shm/shared'
import {useEffect, useRef} from 'react'

type HighlighterProps = {
  onMouseEnter: () => void
  onMouseLeave: () => void
  'data-resourceid'?: string
  'data-blockid'?: string
}

/** Highlights every visible instance of a hovered resource or block, on web and desktop. */
export function setHypermediaHover(id: UnpackedHypermediaId | null, color = 'var(--highlight)') {
  let style = document.getElementById('hypermedia-hover-styles')
  if (!id) {
    document.body.classList.remove('hypermedia-hover')
    style?.remove()
    return
  }
  if (!style) {
    style = document.createElement('style')
    style.id = 'hypermedia-hover-styles'
    document.head.appendChild(style)
  }
  const resource = CSS.escape(id.id)
  const block = id.blockRef && CSS.escape(id.blockRef)
  style.textContent = block
    ? `@scope (body.hypermedia-hover [data-highlight-resource="${resource}"]) to ([data-highlight-resource]) {
        [data-node-type="blockNode"][data-id="${block}"] { background-color: ${color}; }
      }`
    : `body.hypermedia-hover [data-resourceid="${resource}"] { background-color: ${color}; }`
  document.body.classList.add('hypermedia-hover')
}

/** Supplies hover events and identity attributes for a hypermedia reference. */
export function useHighlighter() {
  const {broadcastEvent} = useUniversalAppContext()
  const hovered = useRef(false)
  useEffect(
    () => () => {
      if (hovered.current) setHypermediaHover(null)
    },
    [],
  )
  return (id?: UnpackedHypermediaId | null | undefined): HighlighterProps | {} => {
    if (!id) return {}
    const divProps: HighlighterProps = {
      onMouseEnter: () => {
        hovered.current = true
        setHypermediaHover(id)
        broadcastEvent?.({type: 'hypermediaHoverIn', id})
      },
      onMouseLeave: () => {
        hovered.current = false
        setHypermediaHover(null)
        broadcastEvent?.({type: 'hypermediaHoverOut', id})
      },
    }
    if (id.blockRef) {
      divProps['data-blockid'] = id.blockRef
    } else {
      divProps['data-resourceid'] = id.id
    }
    return divProps
  }
}
