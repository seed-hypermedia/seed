import {useAppContext} from '@/app-context'
import {useCopyReferenceUrl} from '@/components/copy-reference-url'
import {useDeleteDialog} from '@/components/delete-dialog'
import {
  roleCanWrite,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {useMyAccountIds} from '@/models/daemon'
import {useAccountDraftList, useCreateDraft} from '@/models/documents'
import {draftEditId, draftLocationId} from '@/models/drafts'
import {useSubscribedResource} from '@/models/entities'
import {useGatewayUrl} from '@/models/gateway-settings'
import {useHostSession} from '@/models/host'
import {useSelectedAccount} from '@/selected-account'
import {SidebarContext} from '@/sidebar-context'
import {convertBlocksToMarkdown} from '@/utils/blocks-to-markdown'
import {
  useNavRoute,
  useNavigationDispatch,
  useNavigationState,
} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {hostnameStripProtocol} from '@shm/shared'
import {hmBlocksToEditorContent} from '@shm/shared/client/hmblock-to-editorblock'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {HMBlockNode, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {DocumentRoute, DraftRoute} from '@shm/shared/routes'
import {
  displayHostname,
  hmId,
  latestId,
  pathMatches,
} from '@shm/shared/utils/entity-id-url'
import {HMIcon} from '@shm/ui/hm-icon'
import {
  ArrowRight,
  Back,
  CloudOff,
  Download,
  Forward,
  Link,
  Pencil,
  Trash,
  UploadCloud,
} from '@shm/ui/icons'
import {MenuItemType, OptionsDropdown} from '@shm/ui/options-dropdown'
import {TitlebarSection} from '@shm/ui/titlebar'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useStream} from '@shm/ui/use-stream'
import {
  ArrowLeftFromLine,
  ArrowRightFromLine,
  FilePlus,
  ForwardIcon,
  GitFork,
  Import,
  PanelLeft,
  PanelRight,
} from 'lucide-react'
import {nanoid} from 'nanoid'
import {ReactNode, useContext, useEffect, useRef, useState} from 'react'
import {Button, ColorProp, Popover, SizableText, XGroup} from 'tamagui'
import {BranchDialog} from './branch-dialog'
import {useAppDialog} from './dialog'
import DiscardDraftButton from './discard-draft-button'
import {useImportDialog, useImporting} from './import-doc-button'
import {MoveDialog} from './move-dialog'
import {editPopoverEvents} from './onboarding'
import PublishDraftButton from './publish-draft-button'
import {
  usePublishSite,
  useRemoveSiteDialog,
  useSeedHostDialog,
} from './publish-site'
import {SubscriptionButton} from './subscription'
import {TitleBarProps} from './titlebar'

export function DocOptionsButton({
  onPublishSite,
}: {
  onPublishSite: (input: {
    id: UnpackedHypermediaId
    step?: 'seed-host-custom-domain'
  }) => void
}) {
  const route = useNavRoute()
  const dispatch = useNavigationDispatch()
  if (route.key !== 'document')
    throw new Error(
      'DocOptionsButton can only be rendered on publication route',
    )
  const {exportDocument, openDirectory} = useAppContext()
  const deleteEntity = useDeleteDialog()
  const gwUrl = useGatewayUrl().data || DEFAULT_GATEWAY_URL
  const resource = useResource(route.id)
  const doc =
    resource.data?.type === 'document' ? resource.data.document : undefined
  const rootEntity = useResource(hmId(route.id.uid))
  const rootDocument =
    rootEntity.data?.type === 'document' ? rootEntity.data.document : undefined
  const siteUrl = rootDocument?.metadata.siteUrl
  const copyLatest =
    route.id.latest || !route.id.version || doc?.version === route.id.version
  const [copyGatewayContent, onCopyGateway] = useCopyReferenceUrl(gwUrl)
  const [copySiteUrlContent, onCopySiteUrl] = useCopyReferenceUrl(
    siteUrl || gwUrl,
    siteUrl ? hmId(route.id.uid) : undefined,
  )
  const copyUrlId = {
    ...route.id,
    latest: copyLatest,
    version: doc?.version || null,
  }
  const removeSite = useRemoveSiteDialog()
  const capability = useSelectedAccountCapability(route.id)
  const canEditDoc = roleCanWrite(capability?.role)
  const seedHostDialog = useSeedHostDialog()
  const branchDialog = useAppDialog(BranchDialog)
  const moveDialog = useAppDialog(MoveDialog)
  const myAccountIds = useMyAccountIds()
  const pendingDomain = useHostSession().pendingDomains?.find(
    (pending) => pending.siteUid === route.id.uid,
  )
  const menuItems: MenuItemType[] = [
    {
      key: 'link',
      label: `Copy ${displayHostname(gwUrl)} Link`,
      icon: Link,
      onPress: () => {
        onCopyGateway(copyUrlId)
      },
    },
    {
      key: 'export',
      label: 'Export Document',
      icon: Download,
      onPress: async () => {
        if (!doc) return
        const title = doc?.metadata.name || 'document'
        const blocks: HMBlockNode[] | undefined = doc?.content || undefined
        const editorBlocks = hmBlocksToEditorContent(blocks, {
          childrenType: 'Group',
        })
        const markdownWithFiles = await convertBlocksToMarkdown(
          editorBlocks,
          doc,
        )
        const {markdownContent, mediaFiles} = markdownWithFiles
        exportDocument(title, markdownContent, mediaFiles)
          .then((res) => {
            const success = (
              <>
                <div className="flex max-w-[700px] flex-col gap-1.5">
                  <SizableText wordWrap="break-word" textOverflow="break-word">
                    Successfully exported document "{title}" to:{' '}
                    <b>{`${res}`}</b>.
                  </SizableText>
                  <SizableText
                    textDecorationLine="underline"
                    textDecorationColor="currentColor"
                    color="$brand5"
                    tag={'a'}
                    onPress={() => {
                      openDirectory(res)
                    }}
                  >
                    Show directory
                  </SizableText>
                </div>
              </>
            )
            toast.success('', {customContent: success})
          })
          .catch((err) => {
            toast.error(err)
          })
      },
    },
  ]
  if (siteUrl) {
    menuItems.unshift({
      key: 'link-site',
      label: `Copy ${displayHostname(siteUrl)} Link`,
      icon: Link,
      onPress: () => {
        onCopySiteUrl(copyUrlId)
      },
    })
  }
  if (doc && canEditDoc && route.id.path?.length && !route.id.version) {
    menuItems.push({
      key: 'delete',
      label: 'Delete Document',
      icon: Trash,
      onPress: () => {
        deleteEntity.open({
          id: route.id,
          onSuccess: () => {
            dispatch({
              type: 'backplace',
              route: {
                key: 'document',
                id: hmId(route.id.uid, {
                  path: route.id.path?.slice(0, -1),
                }),
              } as any,
            })
          },
        })
      },
    })
  }
  if (!route.id.path?.length && canEditDoc) {
    if (doc?.metadata?.siteUrl) {
      const siteHost = hostnameStripProtocol(doc?.metadata?.siteUrl)
      const gwHost = hostnameStripProtocol(gwUrl)
      if (siteHost.endsWith(gwHost) && !pendingDomain) {
        menuItems.push({
          key: 'publish-custom-domain',
          label: 'Publish Custom Domain',
          icon: UploadCloud,
          onPress: () => {
            onPublishSite({id: route.id, step: 'seed-host-custom-domain'})
          },
        })
      }
      menuItems.push({
        key: 'publish-site',
        label: 'Remove Site from Publication',
        icon: CloudOff,
        color: '$red10',
        onPress: () => {
          removeSite.open(route.id)
        },
      })
    } else
      menuItems.push({
        key: 'publish-site',
        label: 'Publish Site to Domain',
        icon: UploadCloud,
        onPress: () => {
          onPublishSite({id: route.id})
        },
      })
  }
  const createDraft = useCreateDraft({
    locationUid: route.id.uid,
    locationPath: route.id.path || undefined,
  })
  const importDialog = useImportDialog()
  const importing = useImporting(route.id)
  if (canEditDoc) {
    menuItems.push({
      key: 'create-draft',
      label: 'New Document...',
      icon: FilePlus,
      onPress: createDraft,
    })
    menuItems.push({
      key: 'import',
      label: 'Import...',
      icon: Import,
      onPress: () => {
        importDialog.open({
          onImportFile: importing.importFile,
          onImportDirectory: importing.importDirectory,
          onImportWebSite: importing.importWebSite,
        })
      },
    })
  }

  if (myAccountIds.data?.length) {
    menuItems.push({
      key: 'branch',
      label: 'Create Document Branch',
      icon: GitFork,
      onPress: () => {
        branchDialog.open(route.id)
      },
    })
  }

  if (canEditDoc && myAccountIds.data?.length && route.id.path?.length) {
    menuItems.push({
      key: 'move',
      label: 'Move Document',
      icon: ForwardIcon,
      onPress: () => {
        moveDialog.open({
          id: route.id,
        })
      },
    })
  }

  return (
    <>
      {copyGatewayContent}
      {copySiteUrlContent}
      {deleteEntity.content}
      {removeSite.content}
      {importDialog.content}
      {importing.content}
      {seedHostDialog.content}
      {branchDialog.content}
      {moveDialog.content}
      <OptionsDropdown menuItems={menuItems} align="start" side="bottom" />
    </>
  )
}

function useExistingDraft(route: DocumentRoute) {
  const drafts = useAccountDraftList(route.id.uid)
  const existingDraft = drafts.data?.find((d) => {
    const id = d.editId
    if (!id) return false
    return id.uid === route.id.uid && pathMatches(id.path, route.id.path)
  })
  return existingDraft
}

function EditDocButton() {
  const route = useNavRoute()

  if (route.key !== 'document')
    throw new Error('EditDocButton can only be rendered on document route')
  const capability = useSelectedAccountCapability(route.id)
  const navigate = useNavigate()

  const existingDraft = useExistingDraft(route)

  const [popoverVisible, setPopoverVisible] = useState(false)

  useEffect(() => {
    editPopoverEvents.subscribe((visible) => {
      setPopoverVisible(visible)
    })
  }, [])

  const button = (
    <Button
      size="$2"
      chromeless
      hoverStyle={{
        bg: '$color6',
      }}
      theme={existingDraft ? 'yellow' : undefined}
      onPress={() => {
        if (existingDraft) {
          navigate({
            key: 'draft',
            id: existingDraft.id,
            accessory: {key: 'options'},
          })
        } else {
          navigate({
            key: 'draft',
            id: nanoid(10),
            editUid: route.id.uid,
            editPath: route.id.path || [],
            deps: route.id.version ? [route.id.version] : undefined,
            accessory: {key: 'options'},
          })
        }
      }}
      icon={Pencil}
    >
      {existingDraft ? 'Resume Editing' : 'Edit'}
    </Button>
  )
  if (!roleCanWrite(capability?.role)) return null
  if (popoverVisible) {
    return (
      <>
        <div
          className="fixed top-0 left-0 z-[900] flex h-screen w-screen bg-black opacity-50"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            setPopoverVisible(false)
          }}
        />
        <Popover
          open={popoverVisible}
          onOpenChange={(val) => {
            console.log('== ~ onOpenChange ~ val:', val)
            setPopoverVisible(val)
          }}
          stayInFrame
          placement="bottom"
        >
          <Popover.Trigger zIndex="$zIndex.9">{button}</Popover.Trigger>
          <Popover.Content
            borderWidth={1}
            borderColor="$borderColor"
            width="100%"
            maxWidth={400}
            margin="$4"
            enterStyle={{y: -10, opacity: 0}}
            exitStyle={{y: -10, opacity: 0}}
            elevate
            elevation="$3"
            zIndex="$zIndex.9"
            backgroundColor="$background"
            animation={[
              'fast',
              {
                opacity: {
                  overshootClamping: true,
                },
              },
            ]}
          >
            <div className="border-border bg-background absolute -top-2 right-9 h-4 w-4 rotate-45 border border-r-transparent border-b-transparent" />
            <div className="flex flex-col gap-2">
              <SizableText size="$6" fontWeight="bold">
                Start Editing the Content
              </SizableText>
              <SizableText>
                When you press "Edit" you can start customizing the content of
                the current page
              </SizableText>
            </div>
          </Popover.Content>
        </Popover>
      </>
    )
  }
  return (
    <>
      <Tooltip content={existingDraft ? 'Resume Editing' : 'Edit'}>
        {button}
      </Tooltip>
    </>
  )
}

export function PageActionButtons(props: TitleBarProps) {
  const route = useNavRoute()
  if (route.key === 'draft') {
    return (
      <TitlebarSection>
        <DraftActionButtons route={route} />
      </TitlebarSection>
    )
  } else if (route.key === 'document') {
    return <DocumentTitlebarButtons route={route} />
  }
  return null
}

function DraftActionButtons({route}: {route: DraftRoute}) {
  const selectedAccount = useSelectedAccount()
  const draftId = route.id
  const draft = useDraft(draftId)
  const editId = draftEditId(draft.data)
  const locationId = draftLocationId(draft.data)
  const editIdWriteCap = useSelectedAccountCapability(
    editId || locationId,
    'writer',
  )
  if (!selectedAccount?.id) return null
  if ((editId || locationId) && !editIdWriteCap)
    return (
      <div className="flex items-center gap-2">
        <HMIcon
          size={18}
          id={selectedAccount?.id}
          metadata={selectedAccount?.document?.metadata}
        />
        <SizableText size="$2">
          <SizableText fontWeight="bold">
            {selectedAccount?.document?.metadata.name}
          </SizableText>
          {' - '}
          Not Allowed to Publish Here
        </SizableText>
        <AccessorySidebarToggle />
      </div>
    )

  return (
    <>
      <PublishDraftButton key="publish-draft" />
      <DiscardDraftButton key="discard-draft" />
      <AccessorySidebarToggle />
    </>
  )
}

function DocumentTitlebarButtons({route}: {route: DocumentRoute}) {
  const {id} = route
  const latestDoc = useSubscribedResource(latestId(id))
  const isLatest =
    !route.id.version ||
    route.id.latest ||
    latestDoc.data?.id?.version == route.id.version
  const publishSite = usePublishSite()
  const isHomeDoc = !id.path?.length
  const capability = useSelectedAccountCapability(id)
  const canEditDoc = roleCanWrite(capability?.role)
  const entity = useResource(id)
  const showPublishSiteButton =
    isHomeDoc && canEditDoc && !entity.data?.document?.metadata.siteUrl
  return (
    <TitlebarSection>
      {showPublishSiteButton ? (
        <Button
          chromeless
          onPress={() => publishSite.open({id})}
          iconAfter={UploadCloud}
          size="$2"
          backgroundColor="$brand5"
          color="white"
          hoverStyle={{
            backgroundColor: '$brand6',
          }}
        >
          Publish to Web Domain
        </Button>
      ) : null}
      <SubscriptionButton id={route.id} />
      {isLatest ? null : <GoToLatestVersionButton route={route} />}
      {isLatest ? <EditDocButton key="editDoc" /> : null}
      {publishSite.content}
      <AccessorySidebarToggle />
    </TitlebarSection>
  )
}
export function NavigationButtons() {
  const state = useNavigationState()
  const dispatch = useNavigationDispatch()
  if (!state) return null
  return (
    <div className="no-window-drag flex">
      <XGroup>
        <XGroup.Item>
          <Button
            size="$2"
            onPress={() => dispatch({type: 'pop'})}
            chromeless
            hoverStyle={{
              bg: '$color6',
            }}
            disabled={state.routeIndex <= 0}
            opacity={state.routeIndex <= 0 ? 0.5 : 1}
            icon={Back}
          />
        </XGroup.Item>
        <XGroup.Item>
          <Button
            size="$2"
            onPress={() => dispatch({type: 'forward'})}
            chromeless
            hoverStyle={{
              bg: '$color6',
            }}
            disabled={state.routeIndex >= state.routes.length - 1}
            opacity={state.routeIndex >= state.routes.length - 1 ? 0.5 : 1}
            icon={Forward}
          />
        </XGroup.Item>
      </XGroup>
    </div>
  )
}

export function DraftPublicationButtons() {
  return <></>
}

export function NavMenuButton({left}: {left?: ReactNode}) {
  const ctx = useContext(SidebarContext)
  const isLocked = useStream(ctx?.isLocked)
  const isHoverVisible = useStream(ctx?.isHoverVisible)
  let icon = PanelLeft
  let tooltip = 'Lock Sidebar Open'
  let onPress = ctx?.onLockSidebarOpen
  let key = 'lock'
  let color: undefined | ColorProp = undefined

  if (isLocked) {
    tooltip = 'Close Sidebar'
    onPress = ctx?.onCloseSidebar
    key = 'close'
    color = '$color9'
  }

  if (isHoverVisible) {
    icon = !isLocked ? ArrowRightFromLine : ArrowLeftFromLine
  }

  // Add a state to track the last click time to debounce clicks
  const lastClickTime = useRef(0)

  const handleClick = () => {
    if (onPress) {
      const now = Date.now()
      // Only process click if it's been more than 300ms since the last click
      if (now - lastClickTime.current > 300) {
        onPress()
        lastClickTime.current = now
      }
    }
  }

  return (
    <div className="ml-2 flex flex-1 items-center">
      {left || <div />}
      {ctx && (
        <div className="no-window-drag relative z-10">
          <Tooltip
            content={tooltip}
            key={key} // use this key to make sure the component is unmounted when changes, to blur the button and make tooltip disappear
          >
            <Button
              backgroundColor="$colorTransparent"
              size="$2"
              key={key}
              icon={icon}
              chromeless
              hoverStyle={{
                bg: '$color6',
              }}
              onMouseEnter={ctx.onMenuHover}
              onMouseLeave={ctx.onMenuHoverLeave}
              onPress={handleClick}
            />
          </Tooltip>
        </div>
      )}
    </div>
  )
}

function GoToLatestVersionButton({route}: {route: DocumentRoute}) {
  const navigate = useNavigate('push')

  return (
    <Button
      bg="$brand12"
      borderColor="$brand11"
      hoverStyle={{bg: '$brand11', borderColor: '$brand10'}}
      size="$2"
      iconAfter={ArrowRight}
      onPress={() => {
        navigate({
          key: 'document',
          id: {...route.id, version: null, latest: true},
          accessory: route.accessory,
        })
      }}
    >
      Latest Version
    </Button>
  )
}

function AccessorySidebarToggle() {
  const route = useNavRoute()
  const replace = useNavigate('replace')
  const [currentAccessory, setCurrentAccessory] = useState<
    DocumentRoute['accessory'] | null | undefined
  >(() => {
    if (route.key === 'document' || route.key == 'draft') {
      if (typeof route.accessory == 'undefined' || route.accessory == null) {
        return {key: 'discussions'}
      } else {
        return route.accessory
      }
    } else {
      return null
    }
  })

  useEffect(() => {
    if (route.key === 'document' || route.key == 'draft') {
      if (typeof route.accessory == 'undefined' || route.accessory == null) {
        // setCurrentAccessory({key: 'discussions'})
      } else {
        setCurrentAccessory(route.accessory)
      }
    }
  }, [route])

  if (route.key == 'document') {
    return (
      <Tooltip content={route.accessory ? 'Hide Panel' : 'Show Panel'}>
        <Button
          size="$2"
          chromeless
          hoverStyle={{
            bg: '$color6',
          }}
          icon={PanelRight}
          onPress={() => {
            if (route.key === 'document') {
              replace({
                ...route,
                accessory: route.accessory ? null : currentAccessory,
              })
            }
          }}
        />
      </Tooltip>
    )
  } else if (route.key == 'draft') {
    return (
      <Tooltip content={route.accessory ? 'Hide Panel' : 'Show Panel'}>
        <Button
          size="$2"
          chromeless
          hoverStyle={{
            bg: '$color6',
          }}
          icon={PanelRight}
          onPress={() => {
            replace({
              ...route,
              accessory: route.accessory
                ? null
                : {
                    key: 'options',
                  },
            })
          }}
        />
      </Tooltip>
    )
  }
  return null
}

export function TitlebarTitle() {
  const route = useNavRoute()
  if (route.key !== 'document') return null
  return (
    <View userSelect="none" minWidth={100}>
      <DocumentTitle
        id={hmId(route.id.uid, {
          path: route.id.path,
        })}
      />
    </View>
  )
}
