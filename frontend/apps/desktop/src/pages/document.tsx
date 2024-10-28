import {
  AccessoryContainer,
  AccessoryLayout,
} from '@/components/accessory-sidebar'
import {CollaboratorsPanel} from '@/components/collaborators-panel'
import {Directory} from '@/components/directory'
import {Discussion} from '@/components/discussion'
import {LinkNameComponent} from '@/components/document-name'
import {FavoriteButton} from '@/components/favoriting'
import Footer from '@/components/footer'
import {SidebarSpacer} from '@/components/main-wrapper'
import {NewspaperLayout} from '@/components/newspaper-layout'
import {OptionsPanel} from '@/components/options-panel'
import {SubscriptionButton} from '@/components/subscription'
import {CopyReferenceButton} from '@/components/titlebar-common'
import {VersionsPanel} from '@/components/versions-panel'
import '@/editor/editor.css'
import {useMyAccountIds} from '@/models/daemon'
import {useDiscoverEntity, useSubscribedEntity} from '@/models/entities'
import {useOpenUrl} from '@/open-url'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {
  DocAccessoryOption,
  formattedDateLong,
  formattedDateMedium,
  getAccountName,
  getFileUrl,
  UnpackedHypermediaId,
} from '@shm/shared'
import {
  Button,
  ButtonText,
  Check,
  CollaboratorsIcon,
  Container,
  DocContent,
  H1,
  HistoryIcon,
  HMIcon,
  SizableText,
  Spinner,
  Tooltip,
  Separator as TSeparator,
  XStack,
  YStack,
} from '@shm/ui'
import {RadioButtons} from '@shm/ui/src/radio-buttons'
import {ArrowRight, RefreshCw} from '@tamagui/lucide-icons'
import React, {ReactNode, useEffect, useMemo, useRef} from 'react'
import {EntityCitationsAccessory} from '../components/citations'
import {AppDocContentProvider} from './document-content-provider'

export default function DocumentPage() {
  const route = useNavRoute()
  const docId = route.key === 'document' && route.id
  if (!docId) throw new Error('Invalid route, no document id')
  const accessoryKey = route.accessory?.key
  const replace = useNavigate('replace')

  function handleClose() {
    if (route.key !== 'document') return
    replace({...route, accessory: null})
  }
  let accessory: ReactNode = null
  if (accessoryKey === 'citations') {
    accessory = (
      <EntityCitationsAccessory entityId={docId} onClose={handleClose} />
    )
  } else if (accessoryKey === 'options') {
    accessory = <OptionsPanel route={route} onClose={handleClose} />
  } else if (accessoryKey === 'versions') {
    accessory = <VersionsPanel route={route} onClose={handleClose} />
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

  const accessoryOptions: Array<DocAccessoryOption> = []

  // if (docId.type === 'd' && !docId.path?.length) {
  //   accessoryOptions.push({
  //     key: 'options',
  //     label: 'Options',
  //     icon: Contact,
  //   })
  // }

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
    // accessoryOptions.push({
    //   key: 'suggested-changes',
    //   label: 'Suggested Changes',
    //   icon: SuggestedChangesIcon,
    // })
  }
  // accessoryOptions.push({
  //   key: 'comments',
  //   label: 'Comments',
  //   icon: CommentsIcon,
  // })
  // accessoryOptions.push({
  //   key: 'citations',
  //   label: 'Citations',
  //   icon: CitationsIcon,
  // })
  // if (docId.type === 'd' && !docId.path?.length) {
  //   accessoryOptions.push({
  //     key: 'all-documents',
  //     label: 'All Documents',
  //     icon: Document,
  //   })
  //   accessoryOptions.push({
  //     key: 'contacts',
  //     label: 'Contacts',
  //     icon: Contact,
  //   })
  // }
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
  const discovery = useDiscoverEntity(id)
  useEffect(() => {
    // @ts-expect-error
    return window.appWindowEvents?.subscribe((event: AppWindowEvent) => {
      if (event === 'discover') {
        console.log('=== DISCOVERING!')
        discovery.mutate()
      }
    })
  }, [])
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
  const entity = useSubscribedEntity(docId)
  const accountName = getAccountName(entity.data?.document)
  const hasCover = useMemo(
    () => !!entity.data?.document?.metadata.cover,
    [entity.data],
  )
  const hasIcon = useMemo(
    () => !!entity.data?.document?.metadata.icon,
    [entity.data],
  )
  const myAccountIds = useMyAccountIds()
  const docIsInMyAccount = myAccountIds.data?.includes(docId.uid)

  // hm://z6MkqYME8XHQpnxBLVjDWxCkEwbjKQ4ghxpUB8stgzBCNSwD/advances-in-distributed-security?v=bafy2bzaceckzk7vdca2to6o2ms6gdvjyizvfsimp7txftm7mx3ohp7loqskpk
  const authors = useMemo(() => entity.data?.document?.authors, [entity.data])

  if (entity.isLoading) return <Spinner />

  if (entity.data?.document === undefined) {
    return <DocDiscovery docId={docId} />
  }

  if (entity.data?.document?.metadata.layout == 'Seed/Experimental/Newspaper')
    return null

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
          {hasIcon ? (
            <XStack marginTop={hasCover ? -80 : 0}>
              <HMIcon
                size={100}
                id={docId}
                metadata={entity.data?.document?.metadata}
              />
            </XStack>
          ) : null}
          <XStack>
            <H1
              size="$9"
              f={1}
              style={{fontWeight: 'bold', wordBreak: 'break-all'}}
            >
              {accountName}
            </H1>
          </XStack>
          <YStack gap="$2">
            {entity.data?.document?.metadata.siteUrl ? (
              <SiteURLButton
                siteUrl={entity.data?.document?.metadata.siteUrl}
              />
            ) : null}
            <XStack gap="$3" ai="center" jc="space-between" f={1}>
              <XStack gap="$3" ai="center" f={1} flexWrap="wrap">
                {entity.data?.document?.path.length || authors?.length !== 1 ? (
                  <>
                    <XStack ai="center" gap={0} flexWrap="wrap" maxWidth="100%">
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
                              <SizableText
                                key={`${a}-comma`}
                                fontWeight={'bold'}
                              >
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
                  <SizableText
                    flexShrink={0}
                    flexGrow={0}
                    size="$1"
                    hoverStyle={{cursor: 'default'}}
                    color="$color9"
                  >
                    {formattedDateMedium(entity.data?.document?.updateTime)}
                  </SizableText>
                </Tooltip>
                <Separator />
                <CopyReferenceButton
                  docId={docId}
                  isBlockFocused={isBlockFocused}
                  color="$brand5"
                  size="$1"
                >
                  Share
                </CopyReferenceButton>
              </XStack>
              <FavoriteButton id={docId} />
              {docIsInMyAccount ? (
                <XStack ai="center" gap="$2">
                  <Check color="green" />
                  <SizableText userSelect="none" color="$green10" size="$2">
                    Subscribed
                  </SizableText>
                </XStack>
              ) : (
                <SubscriptionButton id={docId} />
              )}
            </XStack>
          </YStack>
          <TSeparator borderColor="$color8" />
        </YStack>
      </Container>
    </YStack>
  )
}

function DocVersionNotFound({docId}: {docId: UnpackedHypermediaId}) {
  const navigate = useNavigate()
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
        <SizableText size="$8" color="$red11">
          Could not find this Version
        </SizableText>
        <SizableText>
          We have discovered a different version of this document.
        </SizableText>
        <XStack>
          <Button
            icon={ArrowRight}
            backgroundColor="$color4"
            onPress={() => {
              navigate({key: 'document', id: {...docId, version: null}})
            }}
          >
            Go to Other Version
          </Button>
        </XStack>
      </YStack>
    </YStack>
  )
}

function DocDiscovery({docId}: {docId: UnpackedHypermediaId}) {
  const discover = useDiscoverEntity(docId)
  useEffect(() => {
    discover.mutate()
  }, [docId.id])
  const didCompleteDiscover =
    !discover.error && !discover.isLoading && !!discover.data
  if (didCompleteDiscover) return <DocVersionNotFound docId={docId} />
  return (
    <YStack paddingVertical="$8">
      <YStack
        alignSelf="center"
        width={600}
        gap="$5"
        borderWidth={1}
        borderColor="$color8"
        borderRadius="$4"
        padding="$5"
        elevation="$4"
      >
        {discover.error ? (
          <SizableText size="$8" fontWeight="bold" color="$red11">
            Could not find this document
          </SizableText>
        ) : (
          <SizableText size="$8" fontWeight="bold">
            Looking for this document...
          </SizableText>
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
      color="$color10"
      size="$2"
      hoverStyle={{textDecorationLine: 'underline'}}
      onPress={() => {
        open(siteUrl)
      }}
    >
      {siteUrl}
    </ButtonText>
  )
}

function DocumentCover({docId}: {docId: UnpackedHypermediaId}) {
  const entity = useSubscribedEntity(docId)
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
  const entity = useSubscribedEntity(docId)

  if (entity.isLoading) return <Spinner />
  if (!entity.data?.document) return null
  if (entity.data.document.metadata.layout === 'Seed/Experimental/Newspaper') {
    return (
      <NewspaperLayout id={docId} metadata={entity.data.document.metadata} />
    )
  }
  const blockId = docId.blockRef
  return (
    <Container clearVerticalSpace padding={0} marginBottom={100}>
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
  const entity = useSubscribedEntity(docId)
  const route = useNavRoute()
  const wrapper = useRef<HTMLDivElement>(null)

  if (route.key !== 'document')
    throw new Error('DocPageAppendix must be in Doc route')

  useEffect(() => {
    if (wrapper.current) {
      if (route.tab && ['discussion', 'directory'].includes(route.tab)) {
        wrapper.current.scrollIntoView({behavior: 'smooth', block: 'start'})
      }
    }
  }, [route.tab])

  let content = <Directory docId={docId} />

  if (route.tab === 'discussion') {
    content = <Discussion docId={docId} />
  }
  if (!entity.data?.document) return null
  return (
    <Container marginBottom={200} ref={wrapper}>
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
