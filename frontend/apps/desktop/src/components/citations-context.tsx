import {Mention} from '@shm/shared/client/.generated/entities/v1alpha/entities_pb'
import {createContext, useContext, useMemo} from 'react'

export type CitationsContext = {
  citations: Mention[] | undefined
  onCitationsOpen: (mentions: Array<Mention>) => void
  highlights: Array<Mention>
  onHighlightCitations: (mentions: Array<Mention>) => void
}

let citationsContext = createContext<CitationsContext>({
  citations: null,
  onCitationsOpen: () => {
    //noop
  },
  highlights: [],
} as any)

export function useCitations() {
  return useContext(citationsContext)
}

export function useCitationsForBlock(blockId: string) {
  let context = useContext(citationsContext)
  let citations = useMemo(() => {
    if (!context) return []
    return context.citations?.filter((link) => {
      return link.targetFragment == blockId
    })
  }, [blockId, context])

  return {
    citations,
    onCitationsOpen: context.onCitationsOpen,
  }
}
