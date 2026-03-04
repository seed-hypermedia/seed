import {createContext, PropsWithChildren, useContext, useMemo} from 'react'
import {HMListedDraft} from './hm-types'

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
}

const defaultValue: QueryBlockDraftsContextValue = {
  targetBlockId: null,
  drafts: [],
}

const QueryBlockDraftsContext = createContext<QueryBlockDraftsContextValue>(defaultValue)

export function QueryBlockDraftsProvider({children, ...value}: PropsWithChildren<QueryBlockDraftsContextValue>) {
  const ctx = useMemo(
    () => value,
    [value.targetBlockId, value.drafts, value.onOpenDraft, value.onDeleteDraft, value.onUpdateDraftName],
  )
  return <QueryBlockDraftsContext.Provider value={ctx}>{children}</QueryBlockDraftsContext.Provider>
}

export function useQueryBlockDrafts(): QueryBlockDraftsContextValue {
  return useContext(QueryBlockDraftsContext)
}
