import {DraftActions, DraftActionsContext} from '@shm/editor/draft-actions-context'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useNavigate} from '@shm/shared/utils/navigation'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {buildInlineDraftWrite} from '@shm/shared/utils/inline-draft'
import {useQuery} from '@tanstack/react-query'
import {nanoid} from 'nanoid'
import {PropsWithChildren, useMemo, useState} from 'react'
import {
  deleteWebDocDraft,
  getWebDocDraft,
  putWebDocDraft,
  webDraftToListedDraft,
} from './web-draft-db'

/** Hook returning a reactive web draft, shaped as a HMListedDraftWithLocation
 * so it satisfies the shared `DraftActions.useInlineDraft` contract. */
function useWebInlineDraft(id: string | undefined) {
  const query = useQuery({
    queryKey: [queryKeys.DRAFT, id],
    queryFn: async () => {
      if (!id) return null
      const draft = await getWebDocDraft(id)
      return draft ? webDraftToListedDraft(draft) : null
    },
    enabled: !!id,
  })
  return {data: query.data}
}

/**
 * Web mirror of `DesktopDraftActionsProvider`. Wires the editor's
 * `DraftActionsContext` to IndexedDB-backed web drafts so the slash menu's
 * "New document" entry and inline child draft embeds work on the web.
 *
 * Pass `canCreateInlineDraft={false}` when the current document is itself an
 * unpublished web draft — child drafts under a placeholder path segment would
 * be orphaned on publish.
 */
export function WebDraftActionsProvider({
  canCreateInlineDraft = true,
  signingAccountId,
  capabilityCid,
  children,
}: PropsWithChildren<{
  canCreateInlineDraft?: boolean
  signingAccountId?: string
  capabilityCid?: string
}>) {
  const navigate = useNavigate()
  const [lastCreatedInlineDraftId, setLastCreatedInlineDraftId] = useState<string | null>(null)

  const value = useMemo<DraftActions>(
    () => ({
      onCreateInlineDraft:
        canCreateInlineDraft && signingAccountId
          ? async (parentId, options) => {
              const writeParams = buildInlineDraftWrite({
                parentId,
                draftId: nanoid(10),
                options,
              })
              console.log('[web-create-doc] slashMenu onCreateInlineDraft', {
                parentId: parentId.id,
                draftId: writeParams.id,
                hasInitialContent: !!options?.initialContent?.length,
              })
              const routeId = hmId(parentId.uid, {path: writeParams.editPath})
              await putWebDocDraft({
                draftId: writeParams.id,
                docId: routeId.id,
                signingAccountId,
                ...(capabilityCid ? {capabilityCid} : {}),
                content: writeParams.content,
                // Avoid persisting an empty `name` — it would emit a
                // setAttribute(name, '') on publish. Only seed a name when the
                // caller ("Turn into doc") supplied one.
                metadata: options?.name ? {name: options.name} : {},
                deps: writeParams.deps,
                navigation: null,
                locationUid: writeParams.locationUid,
                locationPath: writeParams.locationPath,
                editUid: writeParams.editUid,
                editPath: writeParams.editPath,
                cursorPosition: null,
                visibility: writeParams.visibility,
              })
              invalidateQueries([queryKeys.DRAFT, writeParams.id])
              invalidateQueries([queryKeys.DRAFTS_LIST])
              invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT, parentId.uid])
              setLastCreatedInlineDraftId(writeParams.id)
              return {draftId: writeParams.id, draftPath: writeParams.editPath}
            }
          : undefined,
      useInlineDraft: useWebInlineDraft,
      onDeleteDraft: async (id) => {
        await deleteWebDocDraft(id)
        invalidateQueries([queryKeys.DRAFT, id])
        invalidateQueries([queryKeys.DRAFTS_LIST])
        invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
      },
      onOpenDraft: (draftId, draftPath) => {
        getWebDocDraft(draftId).then((draft) => {
          if (!draft) return
          const editUid = draft.editUid ?? draft.locationUid
          if (!editUid) return
          const editPath = draft.editPath?.length ? draft.editPath : draftPath
          navigate({key: 'document', id: hmId(editUid, {path: editPath})})
        })
      },
      onUpdateDraftName: async (draftId, name) => {
        const draft = await getWebDocDraft(draftId)
        if (!draft) throw new Error(`Draft ${draftId} not found`)
        await putWebDocDraft({
          ...draft,
          metadata: {...draft.metadata, name},
        })
        invalidateQueries([queryKeys.DRAFT, draftId])
        invalidateQueries([queryKeys.DRAFTS_LIST])
        invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
      },
      lastCreatedInlineDraftId,
      clearLastCreatedInlineDraftId: (draftId) => {
        setLastCreatedInlineDraftId((current) => (current === draftId ? null : current))
      },
    }),
    [
      canCreateInlineDraft,
      signingAccountId,
      capabilityCid,
      navigate,
      lastCreatedInlineDraftId,
    ],
  )

  return <DraftActionsContext.Provider value={value}>{children}</DraftActionsContext.Provider>
}
