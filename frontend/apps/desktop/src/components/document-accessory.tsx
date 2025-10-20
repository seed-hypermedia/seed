import {draftMachine} from '@/models/draft-machine'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {useSelectedAccount} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {HMBlockNode, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {DocAccessoryOption} from '@shm/shared/routes'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Feed2} from '@shm/ui/feed'
import {ReactNode} from 'react'
import {ActorRefFrom} from 'xstate'
import {CollaboratorsPanel} from './collaborators-panel'
import {CommentBox} from './commenting'
import {DirectoryPanel} from './directory-panel'
import {DiscussionsPanel} from './discussions-panel'
import {OptionsPanel} from './options-panel'

export function useDocumentAccessory({
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
  state?: any // TODO: fix this type
  actor?: ActorRefFrom<typeof draftMachine>
  isEditingHomeDoc?: boolean
  isNewDraft?: boolean
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  deleteCommentDialogContent?: ReactNode
  targetDomain?: string
}): {
  accessory: ReactNode | null
  accessoryOptions: Array<DocAccessoryOption>
} {
  const route = useNavRoute()
  const replace = useNavigate('replace')
  if (route.key != 'document' && route.key != 'draft' && route.key != 'feed')
    return {accessory: null, accessoryOptions: []}

  let accessory: ReactNode = null
  const accessoryKey = route.accessory?.key
  const accessoryOptions: Array<DocAccessoryOption> = []

  const selectedAccount = useSelectedAccount()

  if (accessoryKey === 'collaborators') {
    // @ts-expect-error
    accessory = <CollaboratorsPanel docId={docId} />
  } else if (accessoryKey === 'directory') {
    accessory = docId ? <DirectoryPanel docId={docId} /> : null
  } else if (accessoryKey === 'options' || isNewDraft) {
    // TODO update options panel flow of updating from newspaper layout
    accessory =
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
  } else {
    let filterEventType: Array<string> | undefined = undefined

    if (accessoryKey == 'contacts') {
      filterEventType = ['Contact', 'Profile']
    }

    if (accessoryKey == 'activity') {
      if (route.accessory?.openComment || route.accessory?.openBlockId) {
        accessory = (
          <DiscussionsPanel
            // @ts-expect-error
            docId={docId}
            accessory={route.accessory}
            onAccessory={(acc) => {
              replace({...route, accessory: acc})
            }}
          />
        )
      } else {
        accessory = (
          <AppDocContentProvider
            docId={docId}
            comment
            textUnit={14}
            layoutUnit={16}
          >
            {deleteCommentDialogContent}
            <Feed2
              commentEditor={
                docId ? (
                  <CommentBox
                    docId={docId}
                    context="accessory"
                    autoFocus={
                      route.accessory?.key === 'activity'
                        ? route.accessory?.autoFocus
                        : undefined
                    }
                  />
                ) : null
              }
              filterResource={docId?.id}
              currentAccount={selectedAccount?.id.uid || ''}
              filterEventType={filterEventType}
              onCommentDelete={onCommentDelete}
              targetDomain={targetDomain}
            />
          </AppDocContentProvider>
        )
      }
    } else {
      accessory = (
        <AppDocContentProvider
          docId={docId}
          comment
          textUnit={16}
          layoutUnit={18}
        >
          {deleteCommentDialogContent}
          <Feed2
            commentEditor={
              docId ? <CommentBox docId={docId} context="accessory" /> : null
            }
            filterResource={docId?.id}
            currentAccount={selectedAccount?.id.uid || ''}
            filterEventType={filterEventType}
            onCommentDelete={onCommentDelete}
            targetDomain={targetDomain}
          />
        </AppDocContentProvider>
      )
    }
  }

  if (route.key == 'draft') {
    accessoryOptions.push({
      key: 'options',
      label: 'Draft Options',
    })
  }

  if (docId) {
    accessoryOptions.push({
      key: 'activity',
      label: 'Feed',
    })

    accessoryOptions.push({
      key: 'collaborators',
      label: 'Collaborators',
    })

    accessoryOptions.push({
      key: 'directory',
      label: 'Directory',
    })
  }

  return {
    accessoryOptions,
    accessory,
  }
}
