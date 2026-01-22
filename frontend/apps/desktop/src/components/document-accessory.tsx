import {
  roleCanWrite,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useCreateDraft} from '@/models/documents'
import {draftMachine, DraftMachineState} from '@/models/draft-machine'
import {useSelectedAccount} from '@/selected-account'
import {HMBlockNode, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {DocSelectionOption} from '@shm/shared/routes'
import {getRouteKey, useNavRoute} from '@shm/shared/utils/navigation'
import {Button, ButtonProps} from '@shm/ui/button'
import {DirectoryPanel} from '@shm/ui/directory-panel'
import {Feed} from '@shm/ui/feed'
import {MoreHorizontal} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {useScrollRestoration} from '@shm/ui/use-scroll-restoration'
import {FilePlus} from 'lucide-react'
import {ReactNode, useEffect} from 'react'
import {ActorRefFrom} from 'xstate'
import {CollaboratorsPanel} from './collaborators-panel'
import {DiscussionsPanel} from './discussions-panel'
import {ImportDropdownButton} from './import-doc-button'
import {OptionsPanel} from './options-panel'

/** Hook to check if user can create sub-documents at a location */
export function useCanCreateSubDocument(locationId?: UnpackedHypermediaId) {
  const capability = useSelectedAccountCapability(locationId)
  return locationId ? roleCanWrite(capability?.role) : false
}

export function NewSubDocumentButton({
  locationId,
  size = 'sm',
  importDropdown = true,
}: {
  locationId: UnpackedHypermediaId
  size?: ButtonProps['size']
  importDropdown?: boolean
}) {
  const canEditDoc = useCanCreateSubDocument(locationId)
  const createDraft = useCreateDraft({
    locationUid: locationId.uid,
    locationPath: locationId.path || undefined,
  })
  if (!canEditDoc) return null
  return (
    <div className="flex w-full flex-row items-center gap-2">
      <div className="flex-1">
        <Tooltip content="Create a new document">
          <Button
            size={size}
            variant="default"
            className="w-full"
            onClick={() => createDraft()}
          >
            <FilePlus className="size-4" />
            Create
          </Button>
        </Tooltip>
      </div>
      {importDropdown && (
        <ImportDropdownButton
          id={locationId}
          button={
            <Button size="icon">
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
      )}
    </div>
  )
}

export function useDocumentSelection({
  docId,
  state,
  actor,
  isEditingHomeDoc,
  isNewDraft = false,
  onCommentDelete,
  deleteCommentDialogContent,
  targetDomain,
}: {
  docId?: UnpackedHypermediaId
  state?: DraftMachineState
  actor?: ActorRefFrom<typeof draftMachine>
  isEditingHomeDoc?: boolean
  isNewDraft?: boolean
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  deleteCommentDialogContent?: ReactNode
  targetDomain?: string
}): {
  selectionUI: ReactNode | null
  selectionOptions: Array<DocSelectionOption>
} {
  const route = useNavRoute()

  // Create scroll restoration refs for activity and contacts panels
  // These need to be called unconditionally
  const activityScrollRef = useScrollRestoration({
    scrollId: docId ? `activity-${docId.id}` : 'activity-no-doc',
    getStorageKey: () => getRouteKey(route),
    debug: false,
  })
  const contactsScrollRef = useScrollRestoration({
    scrollId: docId ? `contacts-${docId.id}` : 'contacts-no-doc',
    getStorageKey: () => getRouteKey(route),
    debug: false,
  })

  // Routes that support panels
  const routesWithPanels = [
    'document',
    'draft',
    'feed',
    'directory',
    'collaborators',
    'activity',
    'discussions',
  ] as const
  const hasPanel = routesWithPanels.includes(route.key as any)

  // Get panel info for activity scroll reset
  const activityPanelFilterEventType =
    (route.key === 'document' ||
      route.key === 'draft' ||
      route.key === 'feed' ||
      route.key === 'directory' ||
      route.key === 'collaborators' ||
      route.key === 'activity' ||
      route.key === 'discussions') &&
    route.panel?.key === 'activity'
      ? route.panel?.filterEventType
      : null

  // Reset scroll when filter changes for activity panel (design decision 2B)
  useEffect(() => {
    if (activityPanelFilterEventType !== null && activityScrollRef.current) {
      const viewport = activityScrollRef.current.querySelector(
        '[data-slot="scroll-area-viewport"]',
      ) as HTMLElement
      if (viewport) {
        viewport.scrollTo({top: 0, behavior: 'instant'})
      }
    }
  }, [activityPanelFilterEventType])

  if (!hasPanel) return {selectionUI: null, selectionOptions: []}

  let selectionUI: ReactNode = null
  // Extract panel info from routes that have panels
  let panelKey: string | undefined
  let discussionsPanel: {key: 'discussions'; openComment?: string} | undefined
  let activityAutoFocus: boolean | undefined
  let activityFilterEventType: string[] | undefined

  if (
    route.key === 'document' ||
    route.key === 'draft' ||
    route.key === 'feed' ||
    route.key === 'directory' ||
    route.key === 'collaborators' ||
    route.key === 'activity' ||
    route.key === 'discussions'
  ) {
    panelKey = route.panel?.key
    if (route.panel?.key === 'discussions') {
      discussionsPanel = route.panel
    }
    if (route.panel?.key === 'activity') {
      activityAutoFocus = route.panel.autoFocus
      activityFilterEventType = route.panel.filterEventType
    }
  }
  const selectionOptions: Array<DocSelectionOption> = []

  const selectedAccount = useSelectedAccount()
  const canCreateSubDoc = useCanCreateSubDocument(docId)

  if (panelKey === 'collaborators') {
    // @ts-expect-error
    selectionUI = <CollaboratorsPanel docId={docId} />
  } else if (panelKey === 'directory') {
    selectionUI = docId ? (
      <DirectoryPanel
        docId={docId}
        header={
          canCreateSubDoc ? (
            <NewSubDocumentButton locationId={docId} />
          ) : undefined
        }
      />
    ) : null
  } else if (panelKey === 'options' || isNewDraft) {
    // TODO update options panel flow of updating from newspaper layout
    selectionUI =
      state?.context?.metadata && actor ? (
        <OptionsPanel
          draftId={'UPDATE ME'}
          metadata={state.context.metadata}
          isHomeDoc={isEditingHomeDoc || false}
          onMetadata={(metadata) => {
            if (!metadata) return
            actor.send({type: 'change', metadata})
          }}
          onResetContent={(blockNodes: HMBlockNode[]) => {
            actor.send({type: 'reset.content'})
          }}
        />
      ) : null
  } else if (panelKey === 'discussions') {
    if (discussionsPanel && docId) {
      // DiscussionsPanel expects a full DiscussionsRoute with id
      const fullDiscussionsSelection = {
        ...discussionsPanel,
        id: docId,
      }
      selectionUI = (
        <DiscussionsPanel docId={docId} selection={fullDiscussionsSelection} />
      )
    }
  } else if (panelKey === 'activity') {
    selectionUI = (
      <>
        {deleteCommentDialogContent}
        <Feed
          size="sm"
          filterResource={docId?.id}
          currentAccount={selectedAccount?.id.uid || ''}
          filterEventType={activityFilterEventType || []}
          onCommentDelete={onCommentDelete}
          targetDomain={targetDomain}
          scrollRef={activityScrollRef}
        />
      </>
    )
  } else if (panelKey === 'contacts') {
    selectionUI = (
      <>
        {deleteCommentDialogContent}
        <Feed
          size="sm"
          filterResource={docId?.id}
          currentAccount={selectedAccount?.id.uid || ''}
          filterEventType={['Contact', 'Profile']}
          onCommentDelete={onCommentDelete}
          targetDomain={targetDomain}
          scrollRef={contactsScrollRef}
        />
      </>
    )
  }

  if (route.key == 'draft') {
    selectionOptions.push({
      key: 'options',
      label: 'Draft Options',
    })
  }

  if (docId) {
    selectionOptions.push({
      key: 'activity',
      label: 'Feed',
    })

    selectionOptions.push({
      key: 'discussions',
      label: 'Discussions',
    })

    selectionOptions.push({
      key: 'collaborators',
      label: 'Collaborators',
    })

    selectionOptions.push({
      key: 'directory',
      label: 'Directory',
    })
  }

  return {
    selectionOptions,
    selectionUI,
  }
}
