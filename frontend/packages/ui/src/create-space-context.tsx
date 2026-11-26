import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {useDraftsForAccountSafe} from '@shm/shared/draft-breadcrumb-context'
import {useResource, useSelectedAccountId} from '@shm/shared/models/entity'
import {Plus} from 'lucide-react'
import {createContext, useContext, type ReactNode} from 'react'
import {Button} from './button'
import {PageMessageBox, PageNotFound} from './page-message-states'

export const SPACE_EXISTS_TITLE = 'You already have a space'
export const SPACE_EXISTS_BODY =
  'Each account can only have one space. You can go to your existing space, or sign in with a different account to create a new one.'

const CreateSpaceContext = createContext<(() => void) | null>(null)

/** Lets shared UI launch the platform's "Create a space" flow. */
export function CreateSpaceProvider({open, children}: {open: () => void; children: ReactNode}) {
  return <CreateSpaceContext.Provider value={open}>{children}</CreateSpaceContext.Provider>
}

/** Opener for the platform's "Create a space" flow, or null where none is mounted. */
export function useOpenCreateSpace() {
  return useContext(CreateSpaceContext)
}

/**
 * True once we know the selected account has no space: its home document is
 * not found and no home draft is waiting to be published.
 */
export function useOwnSpaceMissing(): boolean {
  const accountUid = useSelectedAccountId()
  const home = useResource(accountUid ? hmId(accountUid) : undefined)
  const drafts = useDraftsForAccountSafe(accountUid ?? undefined)
  if (!accountUid || home.isFetching || home.data?.type !== 'not-found') return false
  if (drafts.isLoading) return false
  const hasHomeDraft = drafts.data?.some((draft) => draft.editUid === accountUid && !draft.editPath?.length)
  return !hasHomeDraft
}

/** Call to action shown where the selected account's space would be. */
export function CreateSpaceCallToAction({onCreate, className}: {onCreate: () => void; className?: string}) {
  return (
    <div className={className}>
      <div className="border-border flex flex-col gap-3 rounded-xl border border-dashed p-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">You don't have a space yet</span>
          <span className="text-muted-foreground text-sm">
            A space is your own site, where you publish documents and invite people.
          </span>
        </div>
        <Button variant="default" onClick={onCreate}>
          <Plus className="size-4" />
          Create my space
        </Button>
      </div>
    </div>
  )
}

/** Not-found page state that offers space creation when the missing document is the viewer's own home. */
export function PageNotFoundOrCreateSpace({docId}: {docId: UnpackedHypermediaId}) {
  const accountUid = useSelectedAccountId()
  const openCreateSpace = useOpenCreateSpace()
  const ownSpaceMissing = useOwnSpaceMissing()
  if (!openCreateSpace || !ownSpaceMissing || docId.uid !== accountUid || docId.path?.length) {
    return <PageNotFound />
  }
  return (
    <PageMessageBox
      title="You don't have a space yet"
      message="A space is your own site, where you publish documents and invite people."
    >
      <Button variant="default" onClick={openCreateSpace}>
        <Plus className="size-4" />
        Create my space
      </Button>
    </PageMessageBox>
  )
}
