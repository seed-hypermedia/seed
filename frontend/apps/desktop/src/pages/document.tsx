import {
  AccessoryContainer,
  AccessoryLayout,
} from '@/components/accessory-sidebar'
import {useCopyGatewayReference} from '@/components/copy-gateway-reference'
import {Directory} from '@/components/directory'
import {FavoriteButton} from '@/components/favoriting'
import Footer from '@/components/footer'
import {MainWrapper} from '@/components/main-wrapper'
import {Thumbnail} from '@/components/thumbnail'
import {useMyAccountIds} from '@/models/daemon'
import {useEntity} from '@/models/entities'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {DocContent, getProfileName, UnpackedHypermediaId} from '@shm/shared'
import {
  CitationsIcon,
  CollaboratorsIcon,
  CommentsIcon,
  HistoryIcon,
  Section,
  Separator,
  SizableText,
  Spinner,
  SuggestedChangesIcon,
  XStack,
} from '@shm/ui'
import {PageContainer} from '@shm/ui/src/container'
import {RadioButtons} from '@shm/ui/src/radio-buttons'
import {ReactNode} from 'react'
import {EntityCitationsAccessory} from '../components/citations'
import {CopyReferenceButton} from '../components/titlebar-common'
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
    <>
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
    </>
  )
}

function MainDocumentPage() {
  const route = useNavRoute()
  if (route.key !== 'document')
    throw new Error('Invalid route for MainDocumentPage')
  if (!route.id) throw new Error('MainDocumentPage requires id')
  return (
    <MainWrapper>
      <DocPageHeader />
      <DocPageContent docId={route.id} isBlockFocused={route.isBlockFocused} />
      <DocPageAppendix docId={route.id} />
    </MainWrapper>
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

  return (
    <>
      <PageContainer marginTop="$6">
        <Section
          paddingVertical={0}
          gap="$2"
          marginBottom={route.tab !== 'home' ? '$4' : undefined}
        >
          <XStack gap="$4" alignItems="center" justifyContent="space-between">
            <XStack gap="$4" alignItems="center" minHeight={60}>
              {entity.data?.id ? (
                <Thumbnail
                  size={64}
                  id={entity.data?.id}
                  document={entity.data?.document}
                />
              ) : null}
              <SizableText
                whiteSpace="nowrap"
                overflow="hidden"
                textOverflow="ellipsis"
                size="$5"
                fontWeight="700"
              >
                {accountName}
              </SizableText>
            </XStack>

            <XStack space="$2">
              {isMyAccount ? null : <FavoriteButton id={docId} />}
              <CopyReferenceButton />
            </XStack>
          </XStack>
        </Section>
      </PageContainer>
    </>
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
      <AppDocContentProvider routeParams={{blockRef: blockId}}>
        <DocContent
          document={entity.data?.document}
          focusBlockId={isBlockFocused ? blockId : undefined}
        />
        <Separator />
      </AppDocContentProvider>
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
