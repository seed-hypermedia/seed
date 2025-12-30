import {triggerCommentDraftFocus} from '@/components/commenting'
import {useDeleteDraftDialog} from '@/components/delete-draft-dialog'
import {MainWrapper} from '@/components/main-wrapper'
import {useCreateDraft, useDraftList} from '@/models/documents'
import {client} from '@/trpc'
import {useNavigate} from '@/utils/useNavigate'
import {
  formattedDateMedium,
  getMetadataName,
  getParentPaths,
  hmId,
  HMListedCommentDraft,
  HMListedDraft,
  HMMetadataPayload,
  unpackHmId,
} from '@shm/shared'
import {useResource, useResources} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {Button} from '@shm/ui/button'
import {Container, PanelContainer} from '@shm/ui/container'
import {PrivateBadge} from '@shm/ui/private-badge'
import {SizableText} from '@shm/ui/text'
import {useMutation, useQuery} from '@tanstack/react-query'
import {FileText, MessageSquare, Trash} from 'lucide-react'
import React, {useMemo} from 'react'

type UnifiedDraft =
  | ({type: 'document'; breadcrumbs: HMMetadataPayload[]} & HMListedDraft)
  | ({type: 'comment'} & HMListedCommentDraft)

export default function DraftsPage() {
  const documentDrafts = useDraftList()
  const commentDrafts = useQuery({
    queryKey: [queryKeys.COMMENT_DRAFTS_LIST],
    queryFn: () => client.comments.listCommentDrafts.query(),
  })
  const navigate = useNavigate()

  const allTargetDocIds = useMemo(() => {
    const ids = new Set<string>()
    commentDrafts.data?.forEach((draft) => {
      ids.add(draft.targetDocId)
    })
    return Array.from(ids)
  }, [commentDrafts.data])

  const allLocationParents = useMemo(() => {
    const allLocationParents = new Set<string>()
    documentDrafts.data?.forEach((draft) => {
      // @ts-expect-error
      const contextId = draft.editId || draft.locationId
      if (contextId) {
        const uid = contextId.uid
        const parentPaths = getParentPaths(contextId.path)
        parentPaths.forEach((path) => {
          allLocationParents.add(hmId(uid, {path}).id)
        })
      }
    })
    return allLocationParents
  }, [documentDrafts.data])

  const entities = useResources(
    Array.from(allLocationParents)
      .map((id) => unpackHmId(id))
      .filter((id) => !!id),
  )

  const unifiedDrafts = useMemo(() => {
    const docDrafts: UnifiedDraft[] =
      documentDrafts.data?.map((item) => {
        let breadcrumbs: HMMetadataPayload[] = []
        // @ts-expect-error
        const contextId = item.editId || item.locationId
        if (contextId) {
          const uid = contextId.uid
          const parentPaths = getParentPaths(contextId.path)
          // @ts-expect-error
          breadcrumbs =
            // @ts-expect-error
            contextId === item.editId
              ? parentPaths.slice(0, -1)
              : parentPaths.map((path) => {
                  const id = hmId(uid, {path})
                  return {
                    id,
                    metadata:
                      entities.find((e) => {
                        return e.data?.id.id === id.id
                        // @ts-expect-error
                      })?.data?.document?.metadata ?? null,
                  }
                })
        }
        return {
          type: 'document' as const,
          ...item,
          breadcrumbs,
        }
      }) || []

    const commentDraftItems: UnifiedDraft[] =
      commentDrafts.data?.map((item) => ({
        type: 'comment' as const,
        ...item,
      })) || []

    // Combine and sort by lastUpdateTime
    return [...docDrafts, ...commentDraftItems].sort(
      (a, b) => b.lastUpdateTime - a.lastUpdateTime,
    )
  }, [documentDrafts.data, commentDrafts.data, entities])

  const hasNoDrafts =
    !documentDrafts.isLoading &&
    !commentDrafts.isLoading &&
    unifiedDrafts.length === 0

  return (
    <PanelContainer>
      <MainWrapper scrollable>
        <Container centered className="gap-2">
          {hasNoDrafts ? (
            <EmptyDraftsState />
          ) : (
            unifiedDrafts.map((item) => {
              if (item.type === 'document') {
                return (
                  <DocumentDraftItem
                    item={item}
                    key={item.id}
                    breadcrumbs={item.breadcrumbs}
                  />
                )
              } else {
                return <CommentDraftItem item={item} key={item.id} />
              }
            })
          )}
        </Container>
      </MainWrapper>
    </PanelContainer>
  )
}

function EmptyDraftsState() {
  const createDraft = useCreateDraft()
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8">
      <FileText className="text-muted-foreground size-16" strokeWidth={1} />
      <div className="flex flex-col items-center gap-2 text-center">
        <SizableText size="lg" weight="bold">
          No drafts yet
        </SizableText>
        <SizableText size="sm" color="muted" className="max-w-md">
          Start creating documents and comments. Your drafts will automatically
          be saved here.
        </SizableText>
      </div>
      <Button onClick={createDraft}>Create New Draft</Button>
    </div>
  )
}

function DocumentDraftItem({
  item,
  breadcrumbs,
}: {
  item: HMListedDraft
  breadcrumbs: HMMetadataPayload[]
}) {
  const navigate = useNavigate()
  const deleteDialog = useDeleteDraftDialog()
  const metadata = item?.metadata

  return (
    <div
      className="group hover:bg-muted h-auto w-full cursor-pointer rounded px-4 py-2"
      onClick={() => {
        navigate({key: 'draft', id: item.id, accessory: {key: 'options'}})
      }}
    >
      <div className="flex w-full items-center justify-between gap-4 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <div className="flex items-center gap-2 overflow-hidden">
            <FileText className="text-muted-foreground size-4 shrink-0" />
            <div className="flex items-center gap-1 overflow-hidden">
              {breadcrumbs.map((breadcrumb, idx) => (
                <React.Fragment key={breadcrumb.id?.uid || idx}>
                  <Button
                    variant="link"
                    size="xs"
                    className="p-0"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      navigate({
                        key: 'document',
                        id: breadcrumb.id,
                      })
                    }}
                  >
                    {breadcrumb.metadata?.name ??
                      breadcrumb.id?.path?.at(-1) ??
                      '?'}
                  </Button>
                  {idx === breadcrumbs.length - 1 ? null : (
                    <SizableText size="xs" color="muted">
                      /
                    </SizableText>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          <SizableText
            weight="bold"
            className="block w-full truncate overflow-hidden text-left whitespace-nowrap"
          >
            {getMetadataName(metadata)}
          </SizableText>
          {item.visibility === 'PRIVATE' && (
            <div className="mt-1">
              <PrivateBadge />
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <SizableText size="xs" color="muted">
            {formattedDateMedium(new Date(item.lastUpdateTime))}
          </SizableText>

          <Button
            variant="destructive"
            className="hover:bg-destructive/75 dark:hover:bg-destructive/75 cursor-pointer opacity-0 group-hover:opacity-100"
            size="icon"
            onClick={(e) => {
              e.stopPropagation()
              deleteDialog.open({
                draftId: item.id,
                onSuccess: () => {},
              })
            }}
          >
            <Trash className="size-3" />
          </Button>
        </div>
      </div>

      <div onClick={(e) => e.stopPropagation()}>{deleteDialog.content}</div>
    </div>
  )
}

function CommentDraftItem({item}: {item: HMListedCommentDraft}) {
  const navigate = useNavigate()
  const targetDocId = useMemo(() => unpackHmId(item.targetDocId), [item])
  const targetDoc = useResource(targetDocId)
  const deleteCommentDraft = useMutation({
    mutationFn: (input: {
      targetDocId: string
      replyCommentId?: string
      quotingBlockId?: string
      context?: 'accessory' | 'feed' | 'document-content'
    }) => client.comments.removeCommentDraft.mutate(input),
    onSuccess: () => {
      // Invalidate the comment drafts list to refresh the UI
      invalidateQueries([queryKeys.COMMENT_DRAFTS_LIST])
    },
  })

  const contextLabel = useMemo(() => {
    if (item.replyCommentId) return 'Reply'
    if (item.quotingBlockId) return 'Block Quote'
    return 'Comment'
  }, [item])

  const handleDelete = async () => {
    deleteCommentDraft.mutate({
      targetDocId: item.targetDocId,
      replyCommentId: item.replyCommentId,
      quotingBlockId: item.quotingBlockId,
      context: item.context,
    })
  }

  return (
    <div
      className="group hover:bg-muted h-auto w-full cursor-pointer rounded px-4 py-2"
      onClick={() => {
        // Navigate to the target document with the comment editor focused
        if (targetDocId) {
          // Only open activity accessory if the draft was created in accessory context
          const shouldOpenAccessory = item.context === 'accessory'

          const navParams = shouldOpenAccessory
            ? {
                key: 'document' as const,
                id: targetDocId,
                accessory: {
                  key: 'activity' as const,
                  openComment: item.replyCommentId,
                  targetBlockId: item.quotingBlockId,
                  autoFocus: true,
                },
              }
            : {
                key: 'document' as const,
                id: targetDocId,
              }

          navigate(navParams)

          // For non-accessory drafts, use the focus trigger mechanism after navigation
          if (!shouldOpenAccessory) {
            setTimeout(() => {
              triggerCommentDraftFocus(targetDocId.id, item.replyCommentId)
            }, 300)
          }
        }
      }}
    >
      <div className="flex w-full items-center justify-between gap-4 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <div className="flex items-center gap-2">
            <MessageSquare className="text-muted-foreground size-4 shrink-0" />
            {/* <Badge variant="secondary" className="shrink-0 text-xs">
              {contextLabel}
            </Badge> */}
            {item.context && (
              <SizableText size="xs" color="muted" className="capitalize">
                {item.context.replace('-', ' ')}
              </SizableText>
            )}
          </div>

          <SizableText
            weight="bold"
            className="block w-full truncate overflow-hidden text-left whitespace-nowrap"
          >
            {targetDoc.data?.type === 'document'
              ? getMetadataName(targetDoc.data.document.metadata)
              : 'Comment Draft'}
          </SizableText>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <SizableText size="xs" color="muted">
            {formattedDateMedium(new Date(item.lastUpdateTime))}
          </SizableText>

          <Button
            variant="destructive"
            className="hover:bg-destructive/75 dark:hover:bg-destructive/75 cursor-pointer opacity-0 group-hover:opacity-100"
            size="icon"
            onClick={(e) => {
              e.stopPropagation()
              handleDelete()
            }}
          >
            <Trash className="size-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}
