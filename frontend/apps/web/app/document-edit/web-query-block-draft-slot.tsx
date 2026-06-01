import {useResource} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {roleCanWrite, useSelectedAccountCapability} from '@shm/shared/models/capabilities'
import {QueryBlockDraftSlotProps, useQueryBlockDrafts} from '@shm/shared/query-block-drafts-context'
import {useNavigate} from '@shm/shared/utils/navigation'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useQuery} from '@tanstack/react-query'
import {useCallback, useMemo} from 'react'
import {useLocalKeyPair} from '../auth'
import {createWebDocumentDraft} from './web-create-draft'
import {
  deleteWebDocDraft,
  getWebDocDraft,
  listWebDocChildDrafts,
  putWebDocDraft,
  webDraftToListedDraft,
} from './web-draft-db'

/**
 * Web mirror of `DesktopQueryBlockDraftSlot`. Lists inline child drafts of the
 * query target from IndexedDB and exposes create / open / delete / rename
 * callbacks to the editor's `<QueryBlock />` slot UI.
 */
export function WebQueryBlockDraftSlot({targetId, children}: QueryBlockDraftSlotProps) {
  const navigate = useNavigate()
  const userKeyPair = useLocalKeyPair()
  const signingAccountId = userKeyPair?.delegatedAccountUid ?? null
  const capability = useSelectedAccountCapability(targetId ?? undefined)
  const canEdit = roleCanWrite(capability?.role)

  const resource = useResource(targetId ?? undefined)
  const doc = resource.data?.type === 'document' ? resource.data.document : undefined
  const isPrivate = doc?.visibility === 'PRIVATE'

  const {lastCreatedDraftId, setLastCreatedDraftId} = useQueryBlockDrafts()

  const childDraftsQuery = useQuery({
    queryKey: [queryKeys.DRAFTS_LIST_ACCOUNT, targetId?.uid ?? null, ...(targetId?.path ?? [])],
    queryFn: async () => {
      if (!targetId) return []
      const rows = await listWebDocChildDrafts(targetId.uid, targetId.path ?? [])
      return rows.map(webDraftToListedDraft)
    },
    enabled: !!targetId,
  })

  const drafts = useMemo(() => {
    const list = childDraftsQuery.data ?? []
    return list.map((draft) => ({draft, autoFocus: draft.id === lastCreatedDraftId}))
  }, [childDraftsQuery.data, lastCreatedDraftId])

  const onCreateDraft = useMemo(() => {
    if (!targetId || !canEdit || isPrivate || !signingAccountId) return undefined
    return () => {
      void createWebDocumentDraft({
        locationId: targetId,
        signingAccountId,
        visibility: 'PUBLIC',
      }).then(({draftId}) => {
        console.log('[web-create-doc] queryBlock onCreateDraft', {
          targetId: targetId.id,
          draftId,
        })
        setLastCreatedDraftId?.(draftId)
        invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT, targetId.uid])
        invalidateQueries([queryKeys.DRAFTS_LIST])
      })
    }
  }, [targetId, canEdit, isPrivate, signingAccountId, setLastCreatedDraftId])

  const onOpenDraft = useCallback(
    (draftId: string) => {
      getWebDocDraft(draftId).then((draft) => {
        if (!draft) return
        const editUid = draft.editUid ?? draft.locationUid
        if (!editUid) return
        const editPath = draft.editPath ?? []
        navigate({key: 'document', id: hmId(editUid, {path: editPath})})
      })
    },
    [navigate],
  )

  const onDeleteDraft = useCallback(async (draftId: string) => {
    await deleteWebDocDraft(draftId)
    invalidateQueries([queryKeys.DRAFT, draftId])
    invalidateQueries([queryKeys.DRAFTS_LIST])
    invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
  }, [])

  const onUpdateDraftName = useCallback(async (draftId: string, name: string) => {
    const draft = await getWebDocDraft(draftId)
    if (!draft) return
    await putWebDocDraft({
      ...draft,
      metadata: {...draft.metadata, name},
    })
    invalidateQueries([queryKeys.DRAFT, draftId])
    invalidateQueries([queryKeys.DRAFTS_LIST])
    invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
  }, [])

  return (
    <>
      {children({
        drafts,
        onCreateDraft,
        onOpenDraft,
        onDeleteDraft,
        onUpdateDraftName,
      })}
    </>
  )
}
