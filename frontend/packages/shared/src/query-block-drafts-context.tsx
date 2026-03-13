import {HMListedDraft} from '@seed-hypermedia/client/hm-types'
import {createContext, PropsWithChildren, useContext, useMemo} from 'react'

export type QueryBlockDraftItem = {
  draft: HMListedDraft
  autoFocus?: boolean
}

export type QueryBlockDraftsContextValue = {
  targetBlockId: string | null
  drafts: QueryBlockDraftItem[]
  onOpenDraft?: (draftId: string) => void
  onDeleteDraft?: (draftId: string) => void
  onUpdateDraftName?: (draftId: string, name: string) => void
  onCreateDraft?: () => void
}

const defaultValue: QueryBlockDraftsContextValue = {
  targetBlockId: null,
  drafts: [],
}

const QueryBlockDraftsContext = createContext<QueryBlockDraftsContextValue>(defaultValue)

export function QueryBlockDraftsProvider({children, ...value}: PropsWithChildren<QueryBlockDraftsContextValue>) {
  const ctx = useMemo(
    () => value,
    [
      value.targetBlockId,
      value.drafts,
      value.onOpenDraft,
      value.onDeleteDraft,
      value.onUpdateDraftName,
      value.onCreateDraft,
    ],
  )
  return <QueryBlockDraftsContext.Provider value={ctx}>{children}</QueryBlockDraftsContext.Provider>
}

export function useQueryBlockDrafts(): QueryBlockDraftsContextValue {
  return useContext(QueryBlockDraftsContext)
}
