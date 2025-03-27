import {useAppContext} from '@/app-context'
import {useCopyReferenceUrl} from '@/components/copy-reference-url'
import {useDeleteDialog} from '@/components/delete-dialog'
import {roleCanWrite, useMyCapability} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {useMyAccountIds} from '@/models/daemon'
import {useCreateDraft} from '@/models/documents'
import {useSubscribedEntity} from '@/models/entities'
import {useGatewayUrl} from '@/models/gateway-settings'
import {useHostSession} from '@/models/host'
import {SidebarContext, SidebarWidth} from '@/sidebar-context'
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
import {HMBlockNode} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {DocumentRoute} from '@shm/shared/routes'
import {displayHostname, hmId} from '@shm/shared/utils/entity-id-url'
import {
  ArrowLeftFromLine,
  ArrowRight,
  ArrowRightFromLine,
  Back,
  CloudOff,
  Download,
  Forward,
  Link,
  Menu,
  Pencil,
  Trash,
  UploadCloud,
  UserPlus,
} from '@shm/ui/icons'
import {MenuItemType, OptionsDropdown} from '@shm/ui/options-dropdown'
import {TitlebarSection} from '@shm/ui/titlebar'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useStream} from '@shm/ui/use-stream'
import {
  FilePlus,
  Forward as ForwardIcon,
  GitFork,
  Import,
} from '@tamagui/lucide-icons'
import {ReactNode, useContext, useEffect, useState} from 'react'
import {
  Button,
  ColorProp,
  Popover,
  SizableText,
  View,
  XGroup,
  XStack,
  YStack,
} from 'tamagui'
import {BranchDialog} from './branch-dialog'
import {AddConnectionDialog} from './contacts-prompt'
import {useAppDialog} from './dialog'
import DiscardDraftButton from './discard-draft-button'
import {useImportDialog, useImporting} from './import-doc-button'
import {editPopoverEvents} from './onboarding'
import PublishDraftButton from './publish-draft-button'
import {
  usePublishSite,
  useRemoveSiteDialog,
  useSeedHostDialog,
} from './publish-site'
import {SubscriptionButton} from './subscription'
import {TitleBarProps} from './titlebar'

export function DocOptionsButton() {
  const route = useNavRoute()
  const dispatch = useNavigationDispatch()
  if (route.key !== 'document')
    throw new Error(
      'DocOptionsButton can only be rendered on publication route',
    )
  const {exportDocument, openDirectory} = useAppContext()
  const deleteEntity = useDeleteDialog()
  const gwUrl = useGatewayUrl().data || DEFAULT_GATEWAY_URL
  const doc = useEntity(route.id)
  const rootEntity = useEntity(hmId('d', route.id.uid))
  const siteUrl = rootEntity.data?.document?.metadata.siteUrl
  const copyLatest =
    route.id.latest ||
    !route.id.version ||
    doc.data?.document?.version === route.id.version
  const [copyGatewayContent, onCopyGateway] = useCopyReferenceUrl(gwUrl)
  const [copySiteUrlContent, onCopySiteUrl] = useCopyReferenceUrl(
    siteUrl || gwUrl,
    siteUrl ? hmId('d', route.id.uid) : undefined,
  )
  const copyUrlId = {
    ...route.id,
    latest: copyLatest,
    version: doc.data?.document?.version || null,
  }
  const removeSite = useRemoveSiteDialog()
  const publishSite = usePublishSite()
  const capability = useMyCapability(route.id)
  const canEditDoc = roleCanWrite(capability?.role)
  const seedHostDialog = useSeedHostDialog()
  const branchDialog = useAppDialog(BranchDialog)
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
        const title = doc.data?.document?.metadata.name || 'document'
        const blocks: HMBlockNode[] | undefined = doc.data?.document?.content
        const editorBlocks = hmBlocksToEditorContent(blocks, {
          childrenType: 'Group',
        })
        const markdownWithFiles = await convertBlocksToMarkdown(
          editorBlocks,
          doc.data?.document,
        )
        const {markdownContent, mediaFiles} = markdownWithFiles
        exportDocument(title, markdownContent, mediaFiles)
          .then((res) => {
            const success = (
              <>
                <YStack gap="$1.5" maxWidth={700}>
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
                </YStack>
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
  const document = doc.data?.document
  if (document && canEditDoc && route.id.path?.length && !route.id.version) {
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
                id: hmId('d', route.id.uid, {
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
    if (doc.data?.document?.metadata?.siteUrl) {
      const siteHost = hostnameStripProtocol(
        doc.data?.document?.metadata?.siteUrl,
      )
      const gwHost = hostnameStripProtocol(gwUrl)
      if (siteHost.endsWith(gwHost) && !pendingDomain) {
        menuItems.push({
          key: 'publish-custom-domain',
          label: 'Publish Custom Domain',
          icon: UploadCloud,
          onPress: () => {
            publishSite.open({id: route.id, step: 'seed-host-custom-domain'})
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
          publishSite.open({id: route.id})
        },
      })
  }
  const createDraft = useCreateDraft(route.id)
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

  if (canEditDoc && myAccountIds.data?.length) {
    menuItems.push({
      key: 'move',
      label: 'Move Document',
      icon: ForwardIcon,
      onPress: () => {
        // moveDialog.open({})
      },
    })
  }

  return (
    <>
      {copyGatewayContent}
      {copySiteUrlContent}
      {deleteEntity.content}
      {publishSite.content}
      {removeSite.content}
      {importDialog.content}
      {importing.content}
      {seedHostDialog.content}
      {branchDialog.content}
      <OptionsDropdown menuItems={menuItems} />
    </>
  )
}

function EditDocButton() {
  const route = useNavRoute()

  if (route.key !== 'document')
    throw new Error('EditDocButton can only be rendered on document route')
  const capability = useMyCapability(route.id)
  const {data: entity} = useEntity(route.id)
  const navigate = useNavigate()
  const draft = useDraft(route.id)
  const hasExistingDraft = !!draft.data

  const [popoverVisible, setPopoverVisible] = useState(false)

  useEffect(() => {
    editPopoverEvents.subscribe((visible) => {
      setPopoverVisible(visible)
    })
  }, [])

  const button = (
    <Button
      size="$2"
      theme={hasExistingDraft ? 'yellow' : undefined}
      onPress={() => {
        navigate({
          key: 'draft',
          id: entity?.id,
        })
      }}
      icon={Pencil}
    >
      {hasExistingDraft ? 'Resume Editing' : 'Edit'}
    </Button>
  )
  if (!roleCanWrite(capability?.role)) return null
  if (popoverVisible) {
    return (
      <>
        <XStack
          width="100vw"
          height="100vh"
          position="fixed"
          top={0}
          left={0}
          bg="black"
          zIndex="$zIndex.9"
          opacity={0.5}
          onPress={(e) => {
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
            <View
              position="absolute"
              top={-8}
              right={36}
              width={16}
              height={16}
              backgroundColor="$background"
              borderWidth={1}
              borderColor="$borderColor"
              borderRightColor="$colorTransparent"
              borderBottomColor="$colorTransparent"
              transform={[{rotate: '45deg'}]}
            />
            <YStack gap="$2">
              <SizableText size="$6" fontWeight="bold">
                Start Editing the Content
              </SizableText>
              <SizableText>
                When you press "Edit" you can start customizing the content of
                the current page
              </SizableText>
            </YStack>
          </Popover.Content>
        </Popover>
      </>
    )
  }
  return (
    <>
      <Tooltip content={hasExistingDraft ? 'Resume Editing' : 'Edit'}>
        {button}
      </Tooltip>
    </>
  )
}

export function PageActionButtons(props: TitleBarProps) {
  const route = useNavRoute()
  const connectDialog = useAppDialog(AddConnectionDialog)
  let buttonGroup: ReactNode[] = []
  if (route.key === 'draft') {
    buttonGroup = [
      <PublishDraftButton key="publish-draft" />,
      <DiscardDraftButton key="discard-draft" />,
    ]
  } else if (route.key == 'contacts') {
    buttonGroup = [
      <Button
        size="$2"
        bg="$brand12"
        borderColor="$brand11"
        hoverStyle={{
          bg: '$brand11',
          borderColor: '$brand10',
        }}
        onPress={() => {
          connectDialog.open(true)
        }}
        icon={UserPlus}
      >
        Add Connection
      </Button>,
      connectDialog.content,
    ]
  } else if (route.key === 'document' && route.id.type === 'd') {
    return <DocumentTitlebarButtons route={route} />
  }
  return <TitlebarSection>{buttonGroup}</TitlebarSection>
}

function DocumentTitlebarButtons({route}: {route: DocumentRoute}) {
  const latestDoc = useSubscribedEntity({
    ...route.id,
    version: null,
    latest: true,
  })
  const isLatest =
    !route.id.version ||
    route.id.latest ||
    latestDoc.data?.id?.version == route.id.version
  return (
    <TitlebarSection>
      <SubscriptionButton id={route.id} />
      {isLatest ? null : <GoToLatestVersionButton route={route} />}
      {isLatest ? <EditDocButton key="editDoc" /> : null}
      <DocOptionsButton key="options" />
    </TitlebarSection>
  )
}
export function NavigationButtons() {
  const state = useNavigationState()
  const dispatch = useNavigationDispatch()
  if (!state) return null
  return (
    <XStack className="no-window-drag">
      <XGroup>
        <XGroup.Item>
          <Button
            size="$2"
            onPress={() => dispatch({type: 'pop'})}
            chromeless
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
            disabled={state.routeIndex >= state.routes.length - 1}
            opacity={state.routeIndex >= state.routes.length - 1 ? 0.5 : 1}
            icon={Forward}
          />
        </XGroup.Item>
      </XGroup>
    </XStack>
  )
}

export function DraftPublicationButtons() {
  return <></>
}

export function NavMenuButton({left}: {left?: ReactNode}) {
  const ctx = useContext(SidebarContext)
  const isLocked = useStream(ctx?.isLocked)
  const isHoverVisible = useStream(ctx?.isHoverVisible)
  let icon = Menu
  let tooltip = 'Lock Sidebar Open'
  let onPress = ctx?.onLockSidebarOpen
  let key = 'lock'
  let color: undefined | ColorProp = undefined
  if (isLocked) {
    icon = ArrowLeftFromLine
    tooltip = 'Close Sidebar'
    onPress = ctx?.onCloseSidebar
    key = 'close'
    color = '$color9'
  }
  if (!isLocked && isHoverVisible) {
    icon = ArrowRightFromLine
  }

  return (
    <XStack
      marginLeft="$2"
      // intention here is to hide the "close sidebar" button when the sidebar is locked, but the group="item" causes layout issues
      // group="item"
      justifyContent="space-between"
      width={
        isLocked
          ? SidebarWidth - 9 // not sure why this -9 is needed, but it makes the "close sidebar" button properly aligned with the sidebar width
          : 'auto'
      }
    >
      {left || <View />}
      {ctx && (
        <XStack
          position="relative"
          zIndex="$zIndex.1"
          className="no-window-drag"
        >
          <Tooltip
            content={tooltip}
            key={key} // use this key to make sure the component is unmounted when changes, to blur the button and make tooltip disappear
          >
            <Button
              backgroundColor="$colorTransparent"
              size="$2"
              key={key}
              icon={icon}
              color={color}
              // intention here is to hide the button when the sidebar is locked, but the group="item" causes layout issues
              // {...(key === 'close'
              //   ? {opacity: 0, '$group-item-hover': {opacity: 1}}
              //   : {})}
              chromeless={isLocked}
              onMouseEnter={ctx.onMenuHover}
              onMouseLeave={ctx.onMenuHoverLeave}
              onPress={onPress}
            />
          </Tooltip>
        </XStack>
      )}
    </XStack>
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
