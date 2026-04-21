import {HMListedDraft, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {createContext, PropsWithChildren, ReactNode, useContext, useMemo} from 'react'

export type QueryBlockDraftItem = {
  draft: HMListedDraft
  autoFocus?: boolean
}

export type QueryBlockDraftSlotData = {
  drafts: QueryBlockDraftItem[]
  onCreateDraft?: () => void
  onOpenDraft?: (draftId: string) => void
  onDeleteDraft?: (draftId: string) => void
  onUpdateDraftName?: (draftId: string, name: string) => void
}

export type QueryBlockDraftSlotProps = {
  targetId: UnpackedHypermediaId | null
  children: (data: QueryBlockDraftSlotData) => ReactNode
}

export type QueryBlockDraftsContextValue = {
  DraftSlot?: React.ComponentType<QueryBlockDraftSlotProps>
}

const defaultValue: QueryBlockDraftsContextValue = {}

const QueryBlockDraftsContext = createContext<QueryBlockDraftsContextValue>(defaultValue)

export function QueryBlockDraftsProvider({children, DraftSlot}: PropsWithChildren<QueryBlockDraftsContextValue>) {
  const ctx = useMemo(() => ({DraftSlot}), [DraftSlot])
  return <QueryBlockDraftsContext.Provider value={ctx}>{children}</QueryBlockDraftsContext.Provider>
}

export function useQueryBlockDrafts(): QueryBlockDraftsContextValue {
  return useContext(QueryBlockDraftsContext)
}
