import {useLocalKeyPair} from './auth'
import {useState} from 'react'
import {ExploreState} from '@shm/ui/explore-primitives'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@shm/ui/components/alert-dialog'
import {formattedDateMedium} from '@shm/shared'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useNavigate} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {GeneralPageContainer, GeneralPageHeader} from '@shm/ui/general-page'
import {Spinner} from '@shm/ui/spinner'
import {Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useMutation, useQuery} from '@tanstack/react-query'
import {FileText, MessageSquare, Trash} from 'lucide-react'
import {discardWebDraft, listWebDrafts, webDraftResumeReason, type WebDraftItem} from './web-drafts'

/** List all drafts stored in this browser, with resume and discard actions. */
export default function WebDraftsContent() {
  const navigate = useNavigate()
  const keyPair = useLocalKeyPair()
  const [pendingDiscard, setPendingDiscard] = useState<WebDraftItem | null>(null)
  const drafts = useQuery({queryKey: [queryKeys.DRAFTS_LIST, 'web-all'], queryFn: listWebDrafts})
  const discard = useMutation({
    mutationFn: discardWebDraft,
    onSuccess: () => {
      setPendingDiscard(null)
      invalidateQueries([queryKeys.DRAFTS_LIST])
      invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
      invalidateQueries([queryKeys.DRAFT])
      invalidateQueries(['web-doc-draft'])
    },
    onError: () => toast.error('Could not discard draft. Please try again.'),
  })
  return (
    <GeneralPageContainer className="w-full pb-8">
      <GeneralPageHeader title="Drafts" loading={drafts.isLoading} />
      <Text className="text-muted-foreground">Documents and comments saved on this device.</Text>
      {drafts.isError ? (
        <div role="alert" className="flex items-center gap-3">
          <ExploreState
            icon={<FileText />}
            title="Could not load drafts"
            detail="Try loading your local drafts again."
            tone="error"
          />
          <Button variant="outline" onClick={() => void drafts.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {!drafts.isLoading && !drafts.isError && !drafts.data?.length ? (
        <ExploreState
          icon={<FileText />}
          title="No drafts yet"
          detail="Unpublished documents and comments will appear here."
        />
      ) : null}
      <div className="flex flex-col gap-2">
        {drafts.data?.map((draft) => {
          const unavailableReason = webDraftResumeReason(draft, keyPair?.delegatedAccountUid)
          return (
            <div
              key={draft.key}
              className="hover:bg-muted/50 focus-within:ring-ring flex items-center gap-3 rounded-xl border p-3 focus-within:ring-2"
            >
              <button
                type="button"
                disabled={!draft.route || !!unavailableReason}
                title={unavailableReason}
                className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none disabled:opacity-50"
                onClick={() => {
                  if (draft.route) navigate(draft.route)
                }}
              >
                <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
                  {draft.type === 'document' ? (
                    <FileText className="text-muted-foreground size-5" />
                  ) : (
                    <MessageSquare className="text-muted-foreground size-5" />
                  )}
                </div>
                <div className="flex min-w-0 flex-col">
                  <Text weight="medium" className="truncate">
                    {draft.title}
                  </Text>
                  <Text className="text-muted-foreground text-xs">
                    {draft.type === 'document' ? 'Document' : 'Comment'} · Edited{' '}
                    {formattedDateMedium(new Date(draft.updatedAt))}
                  </Text>
                  {unavailableReason ? (
                    <Text className="text-muted-foreground text-xs">{unavailableReason}</Text>
                  ) : null}
                </div>
              </button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Discard ${draft.title}`}
                disabled={discard.isLoading}
                onClick={() => setPendingDiscard(draft)}
              >
                {discard.isLoading && discard.variables?.key === draft.key ? <Spinner /> : <Trash className="size-4" />}
              </Button>
            </div>
          )
        })}
      </div>
      <AlertDialog
        open={!!pendingDiscard}
        onOpenChange={(open) => {
          if (!open && !discard.isLoading) setPendingDiscard(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Discard draft?</AlertDialogTitle>
          <AlertDialogDescription>
            The unpublished content in this draft will be removed from this device.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discard.isLoading}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={discard.isLoading}
              onClick={() => {
                if (pendingDiscard) discard.mutate(pendingDiscard)
              }}
            >
              {discard.isLoading ? 'Discarding…' : 'Discard draft'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GeneralPageContainer>
  )
}
