import {
  AccessoryContainer,
  AccessoryLayout,
} from '@/components/accessory-sidebar'
import {CollaboratorsPanel} from '@/components/collaborators-panel'
import {DocumentActivity} from '@/components/document-activity'
import {DocumentHeadItems} from '@/components/document-head-items'
import {LinkNameComponent} from '@/components/document-name'
import {ImportDropdownButton} from '@/components/import-doc-button'
import {SidebarSpacer} from '@/components/main-wrapper'
import {NewspaperLayout} from '@/components/newspaper-layout'
import {OptionsPanel} from '@/components/options-panel'
import {SiteNavigation} from '@/components/site-navigation'
import {VersionsPanel} from '@/components/versions-panel'
import '@/editor/editor.css'
import {roleCanWrite, useMyCapability} from '@/models/access-control'
import {
  useAccountDraftList,
  useCreateDraft,
  useDocumentRead,
  useListDirectory,
} from '@/models/documents'
import {useDiscoverEntity, useSubscribedEntity} from '@/models/entities'
import {useOpenUrl} from '@/open-url'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {
  DocAccessoryOption,
  getDocumentTitle,
  getFileUrl,
  HMEntityContent,
  hmId,
  UnpackedHypermediaId,
} from '@shm/shared'
import '@shm/shared/src/styles/document.css'
import {
  Add,
  ArrowRight,
  Button,
  ButtonText,
  CollaboratorsIcon,
  Container,
  DocContent,
  DocumentDate,
  getSiteNavDirectory,
  HistoryIcon,
  HMIcon,
  MoreHorizontal,
  NewsSiteHeader,
  RefreshCw,
  SeedHeading,
  SizableText,
  Spinner,
  Separator as TSeparator,
  XStack,
  YStack,
} from '@shm/ui'
import React, {ReactNode, useEffect, useMemo} from 'react'
import {EntityCitationsAccessory} from '../components/citations'
import {AppDocContentProvider} from './document-content-provider'

export default function DocumentPage() {
  const route = useNavRoute()
  const docId = route.key === 'document' && route.id
  useDocumentRead(docId)
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
      <XStack flex={1} height="100%">
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
    </>
  )
}

function BaseDocContainer({children}: {children: ReactNode}) {
  return (
    <Container clearVerticalSpace padding={0}>
      {children}
    </Container>
  )
}

function NewspaperDocContainer({children}: {children: ReactNode}) {
  return <YStack padding={0}>{children}</YStack>
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
  const entity = useSubscribedEntity(id)

  const siteHomeEntity = useSubscribedEntity(
    // if the route document ID matches the home document, then use it because it may be referring to a specific version
    id.path?.length ? hmId('d', id.uid) : id,
    // otherwise, create an ID with the latest version of the home document
  )

  if (entity.isInitialLoading) return <Spinner />
  if (!entity.data?.document) return null

  const docIsNewspaperLayout =
    entity.data?.document?.metadata.layout === 'Seed/Experimental/Newspaper'
  const siteIsNewspaperLayout =
    siteHomeEntity.data?.document?.metadata.layout ===
    'Seed/Experimental/Newspaper'

  const DocContainer = docIsNewspaperLayout
    ? NewspaperDocContainer
    : BaseDocContainer
  return (
    <YStack>
      {siteIsNewspaperLayout ? (
        <AppNewspaperHeader
          siteHomeEntity={siteHomeEntity.data}
          activeId={id}
        />
      ) : null}
      {!docIsNewspaperLayout && <DocumentCover docId={id} />}
      <YStack className={!docIsNewspaperLayout ? 'document-container' : ''}>
        {!docIsNewspaperLayout ? (
          <YStack
            marginTop={150}
            $gtSm={{marginTop: 164}}
            className="is-desktop document-aside"
          >
            <YStack
              className="hide-scrollbar"
              display="none"
              $gtSm={{display: 'flex'}}
              overflow="scroll"
              height="100%"
              // paddingVertical="$4"
            >
              <SiteNavigation />
            </YStack>
          </YStack>
        ) : null}

        <DocContainer>
          <DocPageHeader docId={id} isBlockFocused={isBlockFocused} />
          <YStack flex={1} paddingLeft="$4" $gtSm={{paddingLeft: 0}}>
            <DocPageContent
              blockRef={id.blockRef}
              entity={entity.data}
              isBlockFocused={isBlockFocused}
            />
          </YStack>
          <DocPageAppendix
            centered={
              entity.data.document.metadata.layout ==
              'Seed/Experimental/Newspaper'
            }
            docId={id}
          />
        </DocContainer>
      </YStack>
    </YStack>
  )
}
const MainDocumentPage = React.memo(_MainDocumentPage)

function AppNewspaperHeader({
  siteHomeEntity,
  activeId,
}: {
  siteHomeEntity: HMEntityContent | undefined | null
  activeId: UnpackedHypermediaId
}) {
  const dir = useListDirectory(siteHomeEntity?.id)
  const capability = useMyCapability(siteHomeEntity?.id)
  const canEditDoc = roleCanWrite(capability?.role)
  const drafts = useAccountDraftList(activeId.uid)

  if (!siteHomeEntity) return null
  const navItems = getSiteNavDirectory({
    id: siteHomeEntity.id,
    supportQueries: dir.data
      ? [{in: siteHomeEntity.id, results: dir.data}]
      : [],
    drafts: drafts.data,
  })
  return (
    <NewsSiteHeader
      homeId={siteHomeEntity.id}
      homeMetadata={siteHomeEntity.document?.metadata || null}
      items={navItems}
      docId={activeId}
      rightContent={
        activeId.id === siteHomeEntity.id.id && siteHomeEntity.document ? (
          <DocumentHeadItems
            docId={siteHomeEntity.id}
            isBlockFocused={false}
            document={siteHomeEntity.document}
          />
        ) : null
      }
      afterLinksContent={
        canEditDoc ? (
          <NewSubDocumentButton parentDocId={siteHomeEntity.id} />
        ) : null
      }
    />
  )
}

function NewSubDocumentButton({
  parentDocId,
}: {
  parentDocId: UnpackedHypermediaId
}) {
  const createDraft = useCreateDraft(parentDocId)
  return (
    <>
      <Button icon={Add} color="$green9" onPress={createDraft} size="$2">
        Create
      </Button>
      <ImportDropdownButton
        id={parentDocId}
        button={<Button size="$1" circular icon={MoreHorizontal} />}
      />
    </>
  )
}

function DocPageHeader({
  docId,
  isBlockFocused,
}: {
  docId: UnpackedHypermediaId
  isBlockFocused: boolean
}) {
  const entity = useSubscribedEntity(docId)
  const hasCover = useMemo(
    () => !!entity.data?.document?.metadata.cover,
    [entity.data],
  )
  const hasIcon = useMemo(
    () => !!entity.data?.document?.metadata.icon,
    [entity.data],
  )

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
            <SeedHeading
              level={1}
              f={1}
              style={{fontWeight: 'bold', wordBreak: 'break-word'}}
            >
              {getDocumentTitle(entity.data?.document)}
            </SeedHeading>
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
                {entity.data?.document ? (
                  <DocumentDate document={entity.data.document} />
                ) : null}
              </XStack>
              {entity.data?.document && (
                <DocumentHeadItems
                  document={entity.data.document}
                  docId={docId}
                  isBlockFocused={isBlockFocused}
                />
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
      hoverStyle={{
        textDecorationLine: 'underline',
        textDecorationColor: 'currentColor',
      }}
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
  entity,
  isBlockFocused,
  blockRef,
}: {
  entity: HMEntityContent
  blockId?: string
  isBlockFocused: boolean
  blockRef?: string | null | undefined
}) {
  if (entity.document!.metadata.layout === 'Seed/Experimental/Newspaper') {
    return (
      <NewspaperLayout id={entity.id} metadata={entity.document!.metadata} />
    )
  }
  return (
    <AppDocContentProvider
      routeParams={{blockRef: blockRef || undefined}}
      docId={entity.id}
      isBlockFocused={isBlockFocused}
    >
      <DocContent
        document={entity.document!}
        focusBlockId={isBlockFocused ? blockRef || undefined : undefined}
      />
    </AppDocContentProvider>
  )
}

function DocPageAppendix({
  docId,
  centered = false,
}: {
  docId: UnpackedHypermediaId
  centered: boolean
}) {
  return (
    <Container centered={centered}>
      {/* <Discussion docId={docId} /> */}
      <DocumentActivity docId={docId} />
    </Container>
  )
}
