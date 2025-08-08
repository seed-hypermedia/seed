import {draftMachine} from '@/models/draft-machine'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {HMBlockNode, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {DocAccessoryOption} from '@shm/shared/routes'
import {ReactNode} from 'react'
import {ActorRefFrom} from 'xstate'
import {ActivityPanel} from './activity-panel'
import {CitationsPanel} from './citations-panel'
import {CollaboratorsPanel} from './collaborators-panel'
import {DiscussionsPanel} from './comments-panel'
import {DirectoryPanel} from './directory-panel'
import {OptionsPanel} from './options-panel'
import {VersionsPanel} from './versions-panel'

export function useDocumentAccessory({
  docId,
  state,
  actor,
  isEditingHomeDoc,
  isNewDraft = false,
}: {
  docId?: UnpackedHypermediaId
  state?: any // TODO: fix this type
  actor?: ActorRefFrom<typeof draftMachine>
  isEditingHomeDoc?: boolean
  isNewDraft?: boolean
}): {
  accessory: ReactNode | null
  accessoryOptions: Array<DocAccessoryOption>
} {
  const route = useNavRoute()
  const replace = useNavigate('replace')
  if (route.key !== 'document' && route.key !== 'draft')
    return {accessory: null, accessoryOptions: []}

  let accessory: ReactNode = null
  const accessoryKey = route.accessory?.key
  const accessoryOptions: Array<DocAccessoryOption> = []

  if (accessoryKey == 'citations') {
    accessory = (
      <CitationsPanel
        entityId={docId}
        // @ts-expect-error
        accessory={route.accessory}
        onAccessory={(acc) => {
          replace({...route, accessory: acc})
        }}
      />
    )
  } else if (accessoryKey === 'versions') {
    accessory = <VersionsPanel docId={docId as UnpackedHypermediaId} />
  } else if (accessoryKey === 'activity') {
    accessory = (
      <ActivityPanel
        docId={docId as UnpackedHypermediaId}
        onAccessory={(acc) => {
          replace({...route, accessory: acc})
        }}
      />
    )
  } else if (accessoryKey === 'collaborators') {
    // @ts-expect-error
    accessory = <CollaboratorsPanel docId={docId} />
  } else if (route.accessory?.key === 'discussions') {
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
      label: 'All',
    })

    accessoryOptions.push({
      key: 'versions',
      label: 'Versions',
    })

    accessoryOptions.push({
      key: 'citations',
      label: 'Citations',
    })

    accessoryOptions.push({
      key: 'discussions',
      label: 'Discussions',
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
