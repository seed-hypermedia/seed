import {
  AccessoryContainer,
  AccessoryLayout,
} from '@/components/accessory-sidebar'
import {AvatarForm} from '@/components/avatar-form'
import {useCopyGatewayReference} from '@/components/copy-gateway-reference'
import {Directory} from '@/components/directory'
import {FavoriteButton} from '@/components/favoriting'
import Footer from '@/components/footer'
import {MainWrapper} from '@/components/main-wrapper'
import {CopyReferenceButton} from '@/components/titlebar-common'
import '@/editor/editor.css'
import {useDeleteKey, useMyAccountIds} from '@/models/daemon'
import {useEntity} from '@/models/entities'
import {getFileUrl} from '@/utils/account-url'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {DocContent, getProfileName} from '@shm/shared'
import {
  Button,
  CitationsIcon,
  CollaboratorsIcon,
  CommentsIcon,
  H1,
  HistoryIcon,
  Section,
  Spinner,
  SuggestedChangesIcon,
  Tooltip,
  XStack,
  YStack,
} from '@shm/ui'
import {PageContainer} from '@shm/ui/src/container'
import {RadioButtons} from '@shm/ui/src/radio-buttons'
import {Trash} from '@tamagui/lucide-icons'
import {ReactNode, useMemo} from 'react'
import {EntityCitationsAccessory} from '../components/citations'
import {AppDocContentProvider} from './document-content-provider'

type DocAccessoryOption = {
  key:
    | 'versions'
    | 'collaborators'
    | 'suggested-changes'
    | 'comments'
    | 'citations'
    | 'contacts'
    | 'all-documents'
  label: string
  icon: null | React.FC<{color: string}>
}

export default function DocumentPage() {
  const route = useNavRoute()
  const docId = route.key === 'document' && route.id
  if (!docId) throw new Error('Invalid route, no document id')
  const accessoryKey = route.accessory?.key
  const replace = useNavigate('replace')
  const [copyDialogContent, onCopy] = useCopyGatewayReference()

  function handleClose() {
    if (route.key !== 'document') return
    replace({...route, accessory: null})
  }
  let accessory: ReactNode = null
  if (accessoryKey === 'citations') {
    accessory = (
      <EntityCitationsAccessory entityId={docId} onClose={handleClose} />
    )
  } else if (accessoryKey === 'versions') {
    accessory = <AccessoryContainer title="Versions" onClose={handleClose} />
  } else if (accessoryKey === 'collaborators') {
    accessory = (
      <AccessoryContainer title="Collaborators" onClose={handleClose} />
    )
  } else if (accessoryKey === 'suggested-changes') {
    accessory = (
      <AccessoryContainer title="Suggested Changes" onClose={handleClose} />
    )
  } else if (accessoryKey === 'comments') {
    accessory = <AccessoryContainer title="Comments" onClose={handleClose} />
  } else if (accessoryKey === 'all-documents') {
    accessory = (
      <AccessoryContainer title="All Documents" onClose={handleClose} />
    )
  } else if (accessoryKey === 'contacts') {
    accessory = <AccessoryContainer title="Contacts" onClose={handleClose} />
  }

  const accessoryOptions: DocAccessoryOption[] = []

  accessoryOptions.push({
    key: 'versions',
    label: 'Version History',
    icon: HistoryIcon,
  })
  if (docId.type === 'd') {
    accessoryOptions.push({
      key: 'collaborators',
      label: 'Collaborators',
      icon: CollaboratorsIcon,
    })
    accessoryOptions.push({
      key: 'suggested-changes',
      label: 'Suggested Changes',
      icon: SuggestedChangesIcon,
    })
  }
  accessoryOptions.push({
    key: 'comments',
    label: 'Comments',
    icon: CommentsIcon,
  })
  accessoryOptions.push({
    key: 'citations',
    label: 'Citations',
    icon: CitationsIcon,
  })
  if (docId.type === 'd' && !docId.path?.length) {
    accessoryOptions.push({
      key: 'all-documents',
      label: 'All Documents',
      icon: null,
    })
    accessoryOptions.push({
      key: 'contacts',
      label: 'Contacts',
      icon: null,
    })
  }
  return (
    <MainWrapper>
      <AccessoryLayout
        accessory={accessory}
        accessoryKey={accessoryKey}
        onAccessorySelect={(key: typeof accessoryKey) => {
          if (key === accessoryKey || key === undefined)
            return replace({...route, accessory: null})
          replace({...route, accessory: {key}})
        }}
        accessoryOptions={accessoryOptions}
      >
        <MainDocumentPage />
      </AccessoryLayout>
      <Footer></Footer>
    </MainWrapper>
  )
}

function MainDocumentPage() {
  const route = useNavRoute()
  if (route.key !== 'document')
    throw new Error('Invalid route for MainDocumentPage')
  if (!route.id) throw new Error('MainDocumentPage requires id')
  return (
    <>
      <DocPageHeader />
      <DocPageContent docId={route.id} isBlockFocused={route.isBlockFocused} />
      <DocPageAppendix docId={route.id} />
    </>
  )
}

function DocPageHeader() {
  const route = useNavRoute()
  const replace = useNavigate('replace')
  const docId = route.key === 'document' && route.id
  if (!docId) throw new Error('Invalid route, no entity id')
  const myAccountIds = useMyAccountIds()
  const entity = useEntity(docId)
  const isMyAccount = myAccountIds.data?.includes(docId.id)
  const accountName = getProfileName(entity.data?.document)
  const hasCover = useMemo(
    () => !!entity.data?.document?.metadata.cover,
    [entity.data],
  )
  const hasThumbnail = useMemo(
    () => !!entity.data?.document?.metadata.thumbnail,
    [entity.data],
  )

  return (
    <YStack>
      <DocumentCover docId={docId} />
      <YStack
        id="editor-header-content"
        marginTop={hasCover ? -60 : 60}
        bg="$background"
        borderRadius="$2"
        group="header"
        gap="$4"
      >
        {hasThumbnail ? (
          <XStack marginTop={hasCover ? -50 : 0}>
            <AvatarForm
              size={100}
              id={docId.uid || 'document-thumbnail'}
              label={entity.data?.document?.metadata.name}
              url={getFileUrl(entity.data!.document!.metadata.thumbnail)}
            />
          </XStack>
        ) : null}
        <XStack>
          <H1 size="$9" f={1} style={{fontWeight: 'bold'}}>
            {accountName}
          </H1>
          <XStack gap="$2">
            {isMyAccount ? (
              <DeleteKey accountId={docId.id} />
            ) : (
              <FavoriteButton id={docId} />
            )}
            <CopyReferenceButton />
          </XStack>
        </XStack>
      </YStack>
    </YStack>
  )
}

function DeleteKey({accountId}: {accountId: string}) {
  const deleteKey = useDeleteKey()

  return (
    <Tooltip content="Delete Account Key from this device">
      <Button
        size="$2"
        onPress={() => deleteKey.mutateAsync({accountId})}
        icon={Trash}
        theme="red"
      />
    </Tooltip>
  )
}

function DocumentCover({docId}: {docId: UnpackedHypermediaId}) {
  const entity = useEntity(docId)
  if (!entity.data?.document) return null
  if (!entity.data.document.metadata.cover) return null

  return (
    <XStack bg="black" height="25vh" width="100%" position="relative">
      <img
        src={getFileUrl(entity.data.document.metadata.cover)}
        title={'cover image'}
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
          objectFit: 'cover',
        }}
      />
    </XStack>
  )
}

function DocPageContent({
  docId,
  isBlockFocused,
}: {
  docId: UnpackedHypermediaId
  blockId?: string
  isBlockFocused?: boolean
}) {
  const entity = useEntity(docId)
  const navigate = useNavigate()
  if (entity.isLoading) return <Spinner />
  if (!entity.data?.document) return null
  const blockId = docId.blockRef
  return (
    <PageContainer>
      <Section>
        <AppDocContentProvider routeParams={{blockRef: blockId}}>
          <DocContent
            document={entity.data?.document}
            focusBlockId={isBlockFocused ? blockId : undefined}
          />
        </AppDocContentProvider>
      </Section>
    </PageContainer>
  )
}

function DocPageAppendix({docId}: {docId: UnpackedHypermediaId}) {
  const replace = useNavigate('replace')
  const route = useNavRoute()
  if (route.key !== 'document')
    throw new Error('DocPageAppendix must be in Doc route')
  let content = null
  if (route.tab === 'directory' || !route.tab) {
    content = <Directory docId={docId} />
  }
  return (
    <PageContainer>
      <XStack>
        <RadioButtons
          value={route.tab || 'directory'}
          options={
            [
              {key: 'discussion', label: 'Discussion'},
              {key: 'directory', label: 'Directory'},
            ] as const
          }
          onValue={(value) => {
            replace({...route, tab: value})
          }}
        />
      </XStack>
      {content}
    </PageContainer>
  )
}
