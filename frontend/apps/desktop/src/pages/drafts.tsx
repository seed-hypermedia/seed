import {useDeleteDraftDialog} from '@/components/delete-draft-dialog'
import {MainWrapper} from '@/components/main-wrapper'
import {useCreateDraft, useDraftList} from '@/models/documents'
import {client} from '@/trpc'
import {draftDocumentRouteId} from '@/utils/draft-route'
import {useNavigate} from '@/utils/useNavigate'
import type {HMListedCommentDraft, HMListedDraft, HMMetadataPayload} from '@seed-hypermedia/client/hm-types'
import {formattedDateMedium, getMetadataName, getParentPaths, hmId, unpackHmId} from '@shm/shared'
import {useResource, useResources} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {Button} from '@shm/ui/button'
import {PanelContainer} from '@shm/ui/container'
import {GeneralPageContainer, GeneralPageHeader, GeneralPageSurface} from '@shm/ui/general-page'
import {PrivateBadge} from '@shm/ui/private-badge'
import {Separator} from '@shm/ui/separator'
import {Spinner} from '@shm/ui/spinner'
import {ExploreState} from '@shm/ui/explore-primitives'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@shm/ui/components/alert-dialog'
import {Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useMutation, useQuery} from '@tanstack/react-query'
import {FilePenLine, FileText, MessageSquare, Plus, Trash} from 'lucide-react'
import {useMemo, useState} from 'react'

type DocumentDraft = HMListedDraft & {
  type: 'document'
  breadcrumbs: HMMetadataPayload[]
}
type CommentDraft = HMListedCommentDraft & {type: 'comment'}
type UnifiedDraft = DocumentDraft | CommentDraft

/** DraftsPage lists document and comment drafts with shortcuts to resume or discard them. */
export default function DraftsPage() {
  const documentDrafts = useDraftList()
  const commentDrafts = useQuery({
    queryKey: [queryKeys.COMMENT_DRAFTS_LIST],
    queryFn: () => client.comments.listCommentDrafts.query(),
  })
  const createDraft = useCreateDraft()

  const parentIds = useMemo(() => {
    const ids = new Set<string>()
    documentDrafts.data?.forEach((draft) => {
      const contextId = draft.editUid
        ? hmId(draft.editUid, {path: draft.editPath || []})
        : draft.locationUid
          ? hmId(draft.locationUid, {path: draft.locationPath || []})
          : null
      if (!contextId) return
      getParentPaths(contextId.path).forEach((path) => ids.add(hmId(contextId.uid, {path}).id))
    })
    return Array.from(ids)
  }, [documentDrafts.data])

  const parents = useResources(parentIds.map((id) => unpackHmId(id)).filter((id) => !!id))
  const drafts = useMemo<UnifiedDraft[]>(() => {
    const documents: DocumentDraft[] = (documentDrafts.data || []).map((draft) => {
      const contextId = draft.editUid
        ? hmId(draft.editUid, {path: draft.editPath || []})
        : draft.locationUid
          ? hmId(draft.locationUid, {path: draft.locationPath || []})
          : null
      const parentPaths = contextId ? getParentPaths(contextId.path) : []
      const breadcrumbPaths = draft.editUid ? parentPaths.slice(0, -1) : parentPaths
      return {
        ...draft,
        type: 'document',
        breadcrumbs: contextId
          ? breadcrumbPaths.map((path) => {
              const id = hmId(contextId.uid, {path})
              return {
                id,
                metadata: (() => {
                  const resource = parents.find((parent) => parent.data?.id.id === id.id)?.data
                  return resource?.type === 'document' ? resource.document.metadata : null
                })(),
              }
            })
          : [],
      }
    })
    const comments: CommentDraft[] = (commentDrafts.data || []).map((draft) => ({...draft, type: 'comment'}))
    return [...documents, ...comments].sort((a, b) => b.lastUpdateTime - a.lastUpdateTime)
  }, [commentDrafts.data, documentDrafts.data, parents])

  const isLoading = documentDrafts.isLoading || commentDrafts.isLoading

  return (
    <PanelContainer className="dark:bg-background bg-white">
      <MainWrapper scrollable>
        <GeneralPageSurface>
          <GeneralPageContainer className="pb-8">
            <GeneralPageHeader title="Drafts" loading={isLoading} />
            <Text className="text-muted-foreground">Documents and comments saved on this device.</Text>
            <Separator />
            {documentDrafts.isError || commentDrafts.isError ? (
              <div role="alert" className="flex items-center gap-3">
                <Text>Could not load all drafts.</Text>
                <Button
                  variant="outline"
                  onClick={() => {
                    void documentDrafts.refetch()
                    void commentDrafts.refetch()
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : null}
            {!isLoading && !documentDrafts.isError && !commentDrafts.isError && drafts.length === 0 ? (
              <EmptyDraftsState onCreate={() => void createDraft()} />
            ) : (
              <div className="flex flex-col gap-2">
                {drafts.map((draft) =>
                  draft.type === 'document' ? (
                    <DocumentDraftItem key={`document-${draft.id}`} draft={draft} />
                  ) : (
                    <CommentDraftItem key={`comment-${draft.id}`} draft={draft} />
                  ),
                )}
              </div>
            )}
          </GeneralPageContainer>
        </GeneralPageSurface>
      </MainWrapper>
    </PanelContainer>
  )
}

function EmptyDraftsState({onCreate}: {onCreate: () => void}) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-xl border border-dashed p-8 text-center">
      <ExploreState
        icon={<FilePenLine className="size-6" />}
        title="No drafts yet"
        detail="Unpublished documents and comments will appear here automatically."
      />
      <Button variant="outline" onClick={onCreate}>
        <Plus className="size-4" />
        Create a document
      </Button>
    </div>
  )
}

function DocumentDraftItem({draft}: {draft: DocumentDraft}) {
  const navigate = useNavigate()
  const deleteDialog = useDeleteDraftDialog()
  const breadcrumb = draft.breadcrumbs
    .map((item) => item.metadata?.name || item.id?.path?.at(-1))
    .filter(Boolean)
    .join(' / ')
  const title = getMetadataName(draft.metadata) || 'Untitled document'

  return (
    <div className="group hover:bg-muted/50 focus-within:ring-ring flex items-center gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none"
        onClick={() => {
          const id = draftDocumentRouteId(draft)
          if (id) navigate({key: 'document', id})
        }}
      >
        <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
          <FileText className="text-muted-foreground size-5" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start">
          {breadcrumb ? <Text className="text-muted-foreground truncate text-xs">{breadcrumb}</Text> : null}
          <div className="flex items-center gap-2">
            <Text weight="medium" className="truncate">
              {title}
            </Text>
            {draft.visibility === 'PRIVATE' ? <PrivateBadge /> : null}
          </div>
          <Text className="text-muted-foreground text-xs">
            Edited {formattedDateMedium(new Date(draft.lastUpdateTime))}
          </Text>
        </div>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive focus-visible:text-destructive"
        aria-label={`Discard ${title}`}
        onClick={() => deleteDialog.open({draftId: draft.id})}
      >
        <Trash className="size-4" />
      </Button>
      {deleteDialog.content}
    </div>
  )
}

function CommentDraftItem({draft}: {draft: CommentDraft}) {
  const navigate = useNavigate()
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const targetId = useMemo(() => unpackHmId(draft.targetDocId), [draft.targetDocId])
  const target = useResource(targetId)
  const title = target.data?.type === 'document' ? getMetadataName(target.data.document.metadata) : 'Comment draft'
  const deleteDraft = useMutation({
    mutationFn: () =>
      client.comments.removeCommentDraft.mutate({
        targetDocId: draft.targetDocId,
        replyCommentId: draft.replyCommentId,
        quotingBlockId: draft.quotingBlockId,
        context: draft.context,
      }),
    onSuccess: () => {
      setConfirmDiscard(false)
      invalidateQueries([queryKeys.COMMENT_DRAFTS_LIST])
    },
    onError: () => toast.error('Could not discard draft. Please try again.'),
  })

  return (
    <div className="group hover:bg-muted/50 focus-within:ring-ring flex items-center gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none"
        onClick={() => {
          if (!targetId) return
          navigate({
            key: 'comments',
            id: targetId,
            openComment: draft.replyCommentId,
            targetBlockId: draft.quotingBlockId,
            autoFocus: true,
            isReplying: true,
          })
        }}
      >
        <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
          <MessageSquare className="text-muted-foreground size-5" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <Text className="text-muted-foreground text-xs capitalize">
            {draft.replyCommentId ? 'Reply' : draft.context?.replace('-', ' ') || 'Comment'}
          </Text>
          <Text weight="medium" className="truncate">
            {title}
          </Text>
          <Text className="text-muted-foreground text-xs">
            Edited {formattedDateMedium(new Date(draft.lastUpdateTime))}
          </Text>
        </div>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive focus-visible:text-destructive"
        aria-label={`Discard comment draft on ${title}`}
        disabled={deleteDraft.isLoading}
        onClick={() => setConfirmDiscard(true)}
      >
        {deleteDraft.isLoading ? <Spinner /> : <Trash className="size-4" />}
      </Button>
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogTitle>Discard comment draft?</AlertDialogTitle>
          <AlertDialogDescription>The unpublished comment will be removed from this device.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDraft.isLoading}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={deleteDraft.isLoading} onClick={() => deleteDraft.mutate()}>
              Discard draft
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
