import {
  AccessoryContainer,
  AccessoryLayout,
} from '@/components/accessory-sidebar'
import {CollaboratorsPanel} from '@/components/collaborators-panel'
import {DocNavigation} from '@/components/doc-navigation'
import {DocumentActivity} from '@/components/document-activity'
import {DocumentHeadItems} from '@/components/document-head-items'
import {LinkNameComponent} from '@/components/document-name'
import {ImportDropdownButton} from '@/components/import-doc-button'
import {NewspaperLayout} from '@/components/newspaper-layout'
import {OptionsPanel} from '@/components/options-panel'
import {useTemplateDialog} from '@/components/site-template'
import {VersionsPanel} from '@/components/versions-panel'
import '@/editor/editor.css'
import {roleCanWrite, useMyCapability} from '@/models/access-control'
import {
  useAccountDraftList,
  useCreateDraft,
  useDocumentRead,
  useListDirectory,
} from '@/models/documents'
import {useSubscribedEntity} from '@/models/entities'
import {useOpenUrl} from '@/open-url'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {
  BlockRange,
  DocAccessoryOption,
  getDocumentTitle,
  HMDocument,
  HMEntityContent,
  hmId,
  HMMetadata,
  HMQueryResult,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import '@shm/shared/styles/document.css'
import {Button} from '@shm/ui/button'
import {Container} from '@shm/ui/container'
import {DocContent} from '@shm/ui/document-content'
import {DocumentDate} from '@shm/ui/document-date'
import {useImageUrl} from '@shm/ui/get-file-url'
import {SeedHeading} from '@shm/ui/heading'
import {HMIcon} from '@shm/ui/hm-icon'
import {
  ArrowRight,
  CollaboratorsIcon,
  HistoryIcon,
  MoreHorizontal,
} from '@shm/ui/icons'
import {useDocumentLayout} from '@shm/ui/layout'
import {getSiteNavDirectory} from '@shm/ui/navigation'
import {SiteHeader} from '@shm/ui/site-header'
import {toast} from '@shm/ui/toast'
import {Plus} from '@tamagui/lucide-icons'
import React, {ReactNode, useMemo, useRef} from 'react'
import {
  ButtonText,
  SizableText,
  Spinner,
  Separator as TSeparator,
  XStack,
  XStackProps,
  YStack,
  YStackProps,
} from 'tamagui'
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
  const mainPanelRef = useRef<HTMLDivElement>(null)
  const templateDialogContent = useTemplateDialog(route)
  return (
    <>
      <XStack flex={1} height="100%">
        <AccessoryLayout
          mainPanelRef={mainPanelRef}
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
            onScrollParamSet={(isFrozen) => {
              mainPanelRef.current?.style.setProperty(
                'overflow',
                isFrozen ? 'hidden' : 'auto',
              )
            }}
          />
        </AccessoryLayout>
      </XStack>
      {templateDialogContent}
    </>
  )
}

function BaseDocContainer({
  children,
  ...props
}: XStackProps & {children: ReactNode}) {
  return (
    <Container clearVerticalSpace padding={0} {...props}>
      {children}
    </Container>
  )
}

function NewspaperDocContainer({
  children,
  ...props
}: YStackProps & {children: ReactNode}) {
  return (
    <YStack padding={0} {...props}>
      {children}
    </YStack>
  )
}

function _MainDocumentPage({
  id,
  isBlockFocused,
  onScrollParamSet,
}: {
  id: UnpackedHypermediaId
  isBlockFocused: boolean
  onScrollParamSet: (isFrozen: boolean) => void
}) {
  const replace = useNavigate('replace')
  const entity = useSubscribedEntity(
    id,
    // true for recursive subscription. this component may not require children, but the directory will also be recursively subscribing, and we want to avoid an extra subscription
    true,
    ({redirectTarget}) => {
      if (redirectTarget) {
        toast(`Redirected to this document from ${id.id}`)
        replace({key: 'document', id: redirectTarget})
      }
    },
  )

  const siteHomeEntity = useSubscribedEntity(
    // if the route document ID matches the home document, then use it because it may be referring to a specific version
    id.path?.length ? hmId('d', id.uid) : id,
    // otherwise, create an ID with the latest version of the home document

    id.path?.length ? false : true, // avoiding redundant subscription if the doc is not the home document
  )

  const metadata = entity.data?.document?.metadata
  // IMPORTANT: Always call hooks at the top level, before any early returns
  // This ensures hooks are called in the same order on every render

  const docIsNewspaperLayout =
    metadata?.layout === 'Seed/Experimental/Newspaper'
  const isHomeDoc = !id.path?.length
  const isShowOutline =
    (typeof metadata?.showOutline == 'undefined' || metadata?.showOutline) &&
    !isHomeDoc
  const showSidebarOutlineDirectory = isShowOutline && !isHomeDoc

  const DocContainer = docIsNewspaperLayout
    ? NewspaperDocContainer
    : BaseDocContainer

  const capability = useMyCapability(id)
  const canEditDoc = roleCanWrite(capability?.role)

  const {
    showSidebars,
    sidebarProps,
    mainContentProps,
    elementRef,
    showCollapsed,
    wrapperProps,
  } = useDocumentLayout({
    contentWidth: metadata?.contentWidth,
    showSidebars: showSidebarOutlineDirectory,
  })

  if (entity.isInitialLoading) return null

  if (entity.data?.redirectTarget) {
    return (
      <DocRedirected docId={id} redirectTarget={entity.data.redirectTarget} />
    )
  }

  if (entity.data?.document === undefined) {
    return <DocDiscovery docId={id} />
  }

  return (
    <YStack>
      <AppDocSiteHeader
        siteHomeEntity={siteHomeEntity.data}
        docId={id}
        document={entity.data?.document}
        supportDocuments={[]} // todo: handle embeds for outline!!
        onScrollParamSet={onScrollParamSet}
      >
        {!docIsNewspaperLayout && <DocumentCover docId={id} />}

        <YStack w="100%" ref={elementRef} f={1}>
          <XStack {...wrapperProps}>
            {showSidebars ? (
              <YStack
                {...sidebarProps}
                marginTop={entity.data?.document?.metadata.cover ? 152 : 220}
              >
                <YStack
                  className="hide-scrollbar"
                  overflow="scroll"
                  height="100%"
                  // paddingVertical="$4"
                >
                  <DocNavigation showCollapsed={showCollapsed} />
                </YStack>
              </YStack>
            ) : null}

            <DocContainer {...mainContentProps}>
              {isHomeDoc ? null : <DocPageHeader docId={id} />}
              <YStack flex={1} paddingLeft="$4" $gtSm={{paddingLeft: 0}}>
                <DocPageContent
                  blockRef={id.blockRef}
                  blockRange={id.blockRange}
                  entity={entity.data}
                  isBlockFocused={isBlockFocused}
                />
              </YStack>

              <DocPageAppendix
                centered={metadata?.layout == 'Seed/Experimental/Newspaper'}
                metadata={metadata}
                docId={id}
              />
            </DocContainer>
            {showSidebars ? <YStack {...sidebarProps} /> : null}
          </XStack>
        </YStack>
      </AppDocSiteHeader>
    </YStack>
  )
}
const MainDocumentPage = React.memo(_MainDocumentPage)
const AppDocSiteHeader = React.memo(_AppDocSiteHeader)

function _AppDocSiteHeader({
  siteHomeEntity,
  docId,
  children,
  document,
  supportDocuments,
  onScrollParamSet,
}: {
  siteHomeEntity: HMEntityContent | undefined | null
  docId: UnpackedHypermediaId
  children?: React.ReactNode
  document?: HMDocument
  supportDocuments?: HMEntityContent[]
  onScrollParamSet: (isFrozen: boolean) => void
}) {
  const homeDir = useListDirectory(siteHomeEntity?.id)
  const capability = useMyCapability(siteHomeEntity?.id)
  const canEditDoc = roleCanWrite(capability?.role)
  const drafts = useAccountDraftList(docId.uid)
  const docDir = useListDirectory(docId, {mode: 'Children'})
  const replace = useNavigate('replace')
  const route = useNavRoute()
  const supportQueries = useMemo(() => {
    const q: HMQueryResult[] = []
    if (docDir.data) {
      q.push({in: docId, results: docDir.data})
    }
    if (homeDir.data && siteHomeEntity?.id) {
      q.push({in: siteHomeEntity.id, results: homeDir.data})
    }
    return q
  }, [docId, docDir.data, homeDir.data, siteHomeEntity?.id])
  if (!siteHomeEntity) return null
  if (route.key !== 'document') return null
  const navItems = getSiteNavDirectory({
    id: siteHomeEntity.id,
    supportQueries,
    drafts: drafts.data,
  })
  return (
    <SiteHeader
      originHomeId={null}
      items={navItems}
      docId={docId}
      isCenterLayout={
        siteHomeEntity.document?.metadata.theme?.headerLayout === 'Center' ||
        siteHomeEntity.document?.metadata.layout ===
          'Seed/Experimental/Newspaper'
      }
      document={document}
      onBlockFocus={(blockId) => {
        replace({...route, id: {...route.id, blockRef: blockId}})
      }}
      supportDocuments={[...(supportDocuments || []), siteHomeEntity]}
      supportQueries={supportQueries}
      children={children}
      onShowMobileMenu={(isShown) => {
        onScrollParamSet(isShown)
      }}
    />
  )
}

export function NewSubDocumentButton({
  locationId,
  importDropdown = true,
}: {
  locationId: UnpackedHypermediaId
  importDropdown?: boolean
}) {
  const createDraft = useCreateDraft({
    locationUid: locationId.uid,
    locationPath: locationId.path,
  })
  return (
    <>
      <Button icon={Plus} color="$green9" onPress={createDraft} size="$2">
        Create
      </Button>
      {importDropdown && (
        <ImportDropdownButton
          id={locationId}
          button={<Button size="$1" circular icon={MoreHorizontal} />}
        />
      )}
    </>
  )
}

function DocPageHeader({docId}: {docId: UnpackedHypermediaId}) {
  const entity = useEntity(docId)
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

  if (entity.isLoading) return null
  if (entity.data?.document === undefined) return null

  if (entity.data?.document?.metadata.layout == 'Seed/Experimental/Newspaper')
    return null

  return (
    <YStack>
      <Container
        marginTop={hasCover ? -40 : 0}
        paddingTop={!hasCover ? 60 : '$6'}
        bg="$backgroundTransparent"
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

function DocRedirected({
  docId,
  redirectTarget,
}: {
  docId: UnpackedHypermediaId
  redirectTarget: UnpackedHypermediaId
}) {
  const navigate = useNavigate()
  return (
    <DocMessageBox
      title="Redirected"
      message="This document has been redirected to a new location."
      children={
        <Button
          icon={ArrowRight}
          onPress={() => {
            navigate({key: 'document', id: redirectTarget})
          }}
        >
          Go to New Location
        </Button>
      }
    />
  )
}

function DocMessageBox({
  title,
  message,
  children,
  spinner,
}: {
  title: string
  message: string
  children?: ReactNode
  spinner?: boolean
}) {
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
        <SizableText size="$8" fontWeight="bold">
          {title}
        </SizableText>
        {spinner ? <Spinner /> : null}
        <SizableText>{message}</SizableText>
        {children}
      </YStack>
    </YStack>
  )
}
function DocDiscovery({docId}: {docId: UnpackedHypermediaId}) {
  return (
    <DocMessageBox
      title="Looking for this document..."
      spinner
      message="This document is not on your node yet. Now finding a peer who can provide it."
    />
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
  const entity = useEntity(docId)
  const imageUrl = useImageUrl()
  if (!entity.data?.document) return null
  if (!entity.data.document.metadata.cover) return null

  return (
    <XStack
      bg={
        entity.data.document.metadata.cover
          ? '$backgroundTransparent'
          : 'brand11'
      }
      height="25vh"
      width="100%"
      position="relative"
    >
      <img
        src={imageUrl(entity.data.document.metadata.cover, 'XL')}
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
  blockRange,
}: {
  entity: HMEntityContent
  blockId?: string
  isBlockFocused: boolean
  blockRef?: string | null
  blockRange?: BlockRange | null
}) {
  const replace = useNavigate('replace')
  const route = useNavRoute()

  if (entity.document!.metadata.layout === 'Seed/Experimental/Newspaper') {
    return (
      <NewspaperLayout id={entity.id} metadata={entity.document!.metadata} />
    )
  }
  return (
    <AppDocContentProvider
      routeParams={{
        blockRef: blockRef || undefined,
        blockRange: blockRange || undefined,
      }}
      docId={entity.id}
      isBlockFocused={isBlockFocused}
    >
      <DocContent
        document={entity.document!}
        focusBlockId={isBlockFocused ? blockRef || undefined : undefined}
        handleBlockReplace={() => {
          if (route.key === 'document') {
            // Remove block ref and range from the route.
            replace({
              ...route,
              id: {...route.id, blockRef: null, blockRange: null},
            })
            return true
          }
          return false
        }}
      />
    </AppDocContentProvider>
  )
}

function DocPageAppendix({
  docId,
  centered = false,
  metadata,
}: {
  docId: UnpackedHypermediaId
  centered: boolean
  metadata?: HMMetadata
}) {
  return (
    <Container centered={centered}>
      {/* <Discussion docId={docId} /> */}
      {metadata && metadata.showActivity === false ? null : (
        <DocumentActivity docId={docId} />
      )}
    </Container>
  )
}
