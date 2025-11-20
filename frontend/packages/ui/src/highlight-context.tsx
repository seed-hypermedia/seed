import {UnpackedHypermediaId} from '@shm/shared'

import {useUniversalAppContext} from '@shm/shared'

type HighlighterProps = {
  onMouseEnter: () => void
  onMouseLeave: () => void
  'data-resourceid'?: string
  'data-blockid'?: string
}

export function useHighlighter() {
  const {broadcastEvent} = useUniversalAppContext()
  return (
    id?: UnpackedHypermediaId | null | undefined,
  ): HighlighterProps | {} => {
    if (!id) return {}
    const divProps: HighlighterProps = {
      onMouseEnter: () => {
        broadcastEvent?.({type: 'hypermediaHoverIn', id})
      },
      onMouseLeave: () => {
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
