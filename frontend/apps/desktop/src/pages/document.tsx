import {
  AccessoryContainer,
  AccessoryLayout,
} from '@/components/accessory-sidebar'
import {ThumbnailForm} from '@/components/avatar-form'
import {CollaboratorsPanel} from '@/components/collaborators-panel'
import {useCopyGatewayReference} from '@/components/copy-gateway-reference'
import {Directory} from '@/components/directory'
import {Discussion} from '@/components/discussion'
import {LinkNameComponent} from '@/components/document-name'
import {FavoriteButton} from '@/components/favoriting'
import Footer from '@/components/footer'
import {SidebarSpacer} from '@/components/main-wrapper'
import {CopyReferenceButton} from '@/components/titlebar-common'
import '@/editor/editor.css'
import {useDeleteKey, useMyAccountIds} from '@/models/daemon'
import {useDiscoverEntity, useEntity} from '@/models/entities'
import {useOpenUrl} from '@/open-url'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {
  formattedDateLong,
  formattedDateMedium,
  getAccountName,
  getFileUrl,
  UnpackedHypermediaId,
} from '@shm/shared'
import {
  Button,
  ButtonText,
  CitationsIcon,
  CollaboratorsIcon,
  CommentsIcon,
  Container,
  DocContent,
  H1,
  Heading,
  HistoryIcon,
  SizableText,
  Spinner,
  SuggestedChangesIcon,
  Tooltip,
  Separator as TSeparator,
  XStack,
  YStack,
} from '@shm/ui'
import {RadioButtons} from '@shm/ui/src/radio-buttons'
import {Link, RefreshCw, Trash} from '@tamagui/lucide-icons'
import React, {ReactNode, useEffect, useMemo} from 'react'
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
  icon: null | React.FC<{color: string; size?: number}>
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
    accessory = <CollaboratorsPanel route={route} onClose={handleClose} />
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
      <XStack flex={1}>
        <SidebarSpacer />
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
          <MainDocumentPage
            id={route.id}
            isBlockFocused={route.isBlockFocused || false}
          />
        </AccessoryLayout>
      </XStack>
      <Footer />
    </>
  )
}

function _MainDocumentPage({
  id,
  isBlockFocused,
}: {
  id: UnpackedHypermediaId
  isBlockFocused: boolean
}) {
  return (
    <>
      <DocPageHeader docId={id} isBlockFocused={isBlockFocused} />
      <DocPageContent docId={id} isBlockFocused={isBlockFocused} />
      <DocPageAppendix docId={id} />
    </>
  )
}
const MainDocumentPage = React.memo(_MainDocumentPage)

function DocPageHeader({
  docId,
  isBlockFocused,
}: {
  docId: UnpackedHypermediaId
  isBlockFocused: boolean
}) {
  const myAccountIds = useMyAccountIds()
  const entity = useEntity(docId)
  const isMyAccount = myAccountIds.data?.includes(docId.id)
  const accountName = getAccountName(entity.data?.document)
  const hasCover = useMemo(
    () => !!entity.data?.document?.metadata.cover,
    [entity.data],
  )
  const hasThumbnail = useMemo(
    () => !!entity.data?.document?.metadata.thumbnail,
    [entity.data],
  )

  // hm://z6MkqYME8XHQpnxBLVjDWxCkEwbjKQ4ghxpUB8stgzBCNSwD/advances-in-distributed-security?v=bafy2bzaceckzk7vdca2to6o2ms6gdvjyizvfsimp7txftm7mx3ohp7loqskpk
  const authors = useMemo(() => entity.data?.document?.authors, [entity.data])

  if (entity.isLoading) return <Spinner />

  if (entity.data?.document === undefined) {
    return <DocDiscovery docId={docId} />
  }

  return (
    <YStack>
      <DocumentCover docId={docId} />
      <Container
        marginTop={hasCover ? -40 : 0}
        paddingTop={!hasCover ? 60 : '$6'}
        bg="$background"
        borderRadius="$2"
      >
        <YStack group="header" gap="$4">
          {hasThumbnail ? (
            <XStack marginTop={hasCover ? -80 : 0}>
              <ThumbnailForm
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
              <CopyReferenceButton
                docId={docId}
                isBlockFocused={isBlockFocused}
              />
            </XStack>
          </XStack>

          <XStack marginTop="$4" gap="$3" ai="center">
            {entity.data?.document?.path.length || authors?.length !== 1 ? (
              <>
                <XStack ai="center" gap={0}>
                  {authors
                    ?.map((a, index) => [
                      <LinkNameComponent key={a} accountId={a} />,
                      index !== authors.length - 1 ? (
                        index === authors.length - 2 ? (
                          <SizableText
                            key={`${a}-and`}
                            size="$1"
                            fontWeight={'bold'}
                          >
                            {' & '}
                          </SizableText>
                        ) : (
                          <SizableText key={`${a}-comma`} fontWeight={'bold'}>
                            {', '}
                          </SizableText>
                        )
                      ) : null,
                    ])
                    .filter(Boolean)}
                </XStack>
                <Separator />
              </>
            ) : null}
            <Tooltip
              content={`Update time: ${formattedDateLong(
                entity.data?.document?.updateTime,
              )}`}
            >
              <SizableText size="$1" hoverStyle={{cursor: 'default'}}>
                {formattedDateMedium(entity.data?.document?.updateTime)}
              </SizableText>
            </Tooltip>
            {entity.data?.document?.metadata.siteUrl ? (
              <>
                <Separator />
                <SiteURLButton
                  siteUrl={entity.data?.document?.metadata.siteUrl}
                />
              </>
            ) : null}
            <Separator />
            <Button
              borderColor="$colorTransparent"
              outlineColor="$colorTransparent"
              hoverStyle={{
                borderColor: '$colorTransparent',
                background: '$blue7',
              }}
              color="$blue11"
              size="$1"
              icon={Link}
            >
              Share
            </Button>
          </XStack>
          <TSeparator borderColor="$color8" />
        </YStack>
      </Container>
    </YStack>
  )
}

function DocDiscovery({docId}: {docId: UnpackedHypermediaId}) {
  const discover = useDiscoverEntity(docId)
  useEffect(() => {
    discover.mutate()
  }, [docId.id])
  return (
    <YStack paddingVertical="$8">
      <YStack
        alignSelf="center"
        maxWidth={600}
        gap="$5"
        borderWidth={1}
        borderColor="$color8"
        borderRadius="$2"
        padding="$5"
      >
        {discover.error ? (
          <Heading color="$red11">Could not find this document</Heading>
        ) : (
          <Heading>Looking for this document...</Heading>
        )}
        {discover.error ? (
          <SizableText color="$red11">{discover.error.message}</SizableText>
        ) : null}
        {discover.isLoading ? (
          <>
            <Spinner />
            <SizableText>
              This document is not on your node yet. Now finding a peer who can
              provide it.
            </SizableText>
          </>
        ) : null}
        <XStack>
          {discover.isError ? (
            <Button
              icon={RefreshCw}
              backgroundColor="$color4"
              onPress={() => {
                discover.reset()
                discover.mutate()
              }}
            >
              Retry Document Discovery
            </Button>
          ) : null}
        </XStack>
      </YStack>
    </YStack>
  )
}
const Separator = () => <TSeparator borderColor="$color8" vertical h={20} />

function SiteURLButton({siteUrl}: {siteUrl?: string}) {
  const open = useOpenUrl()
  if (!siteUrl) return null
  return (
    <ButtonText
      color="$blue10"
      hoverStyle={{textDecoration: 'underline'}}
      onPress={() => {
        open(siteUrl)
      }}
    >
      {siteUrl}
    </ButtonText>
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
  isBlockFocused: boolean
}) {
  const entity = useEntity(docId)
  if (entity.isLoading) return <Spinner />
  if (!entity.data?.document) return null
  const blockId = docId.blockRef
  return (
    <Container clearVerticalSpace padding={0}>
      <AppDocContentProvider
        routeParams={{blockRef: blockId || undefined}}
        docId={docId}
        isBlockFocused={isBlockFocused}
      >
        <DocContent
          document={entity.data?.document}
          focusBlockId={isBlockFocused ? blockId || undefined : undefined}
        />
      </AppDocContentProvider>
    </Container>
  )
}

function DocPageAppendix({docId}: {docId: UnpackedHypermediaId}) {
  const replace = useNavigate('replace')
  const entity = useEntity(docId)
  const route = useNavRoute()
  if (route.key !== 'document')
    throw new Error('DocPageAppendix must be in Doc route')
  let content = <Directory docId={docId} />

  if (route.tab === 'discussion') {
    content = <Discussion docId={docId} />
  }
  if (!entity.data?.document) return null
  return (
    <Container>
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
    </Container>
  )
}
