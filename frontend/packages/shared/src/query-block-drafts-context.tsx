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
  onMoveDraft?: (draftId: string) => void
  onUpdateDraftName?: (draftId: string, name: string) => void
}

export type QueryBlockDraftSlotProps = {
  targetId: UnpackedHypermediaId | null
  children: (data: QueryBlockDraftSlotData) => ReactNode
}

export type QueryBlockDraftsContextValue = {
  DraftSlot?: React.ComponentType<QueryBlockDraftSlotProps>
  lastCreatedDraftId?: string | null
  setLastCreatedDraftId?: (id: string | null) => void
}

const defaultValue: QueryBlockDraftsContextValue = {}

const QueryBlockDraftsContext = createContext<QueryBlockDraftsContextValue>(defaultValue)

export function QueryBlockDraftsProvider({
  children,
  DraftSlot,
  lastCreatedDraftId,
  setLastCreatedDraftId,
}: PropsWithChildren<QueryBlockDraftsContextValue>) {
  const ctx = useMemo(
    () => ({DraftSlot, lastCreatedDraftId, setLastCreatedDraftId}),
    [DraftSlot, lastCreatedDraftId, setLastCreatedDraftId],
  )
  return <QueryBlockDraftsContext.Provider value={ctx}>{children}</QueryBlockDraftsContext.Provider>
}

export function useQueryBlockDrafts(): QueryBlockDraftsContextValue {
  return useContext(QueryBlockDraftsContext)
}
