import {useAppContext} from '@/app-context'
import {useCopyGatewayReference} from '@/components/copy-gateway-reference'
import {useDeleteDialog} from '@/components/delete-dialog'
import {MenuItemType, OptionsDropdown} from '@/components/options-dropdown'
import {useMyCapability} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {useEntity} from '@/models/entities'
import {useGatewayHost, useGatewayUrl} from '@/models/gateway-settings'
import {SidebarWidth, useSidebarContext} from '@/sidebar-context'
import {convertBlocksToMarkdown} from '@/utils/blocks-to-markdown'
import {
  useNavRoute,
  useNavigationDispatch,
  useNavigationState,
} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {
  BlockRange,
  ExpandedBlockRange,
  HMBlockNode,
  UnpackedHypermediaId,
  createSiteUrl,
  createWebHMUrl,
  getDocumentTitle,
  hmBlocksToEditorContent,
  hmId,
  packHmId,
} from '@shm/shared'
import {
  Back,
  Button,
  ButtonProps,
  ColorProp,
  Forward,
  Menu,
  TitlebarSection,
  Tooltip,
  View,
  XGroup,
  XStack,
  copyTextToClipboard,
  useStream,
} from '@shm/ui'
import {
  ArrowLeftFromLine,
  ArrowRightFromLine,
  CloudOff,
  Download,
  ExternalLink,
  Link,
  Pencil,
  Trash,
  UploadCloud,
  UserPlus,
} from '@tamagui/lucide-icons'
import {PropsWithChildren, ReactNode, useState} from 'react'
import {AddConnectionDialog} from './contacts-prompt'
import {useAppDialog} from './dialog'
import DiscardDraftButton from './discard-draft-button'
import PublishDraftButton from './publish-draft-button'
import {usePublishSite, useRemoveSiteDialog} from './publish-site'
import {TitleBarProps} from './titlebar'

export function DocOptionsButton() {
  const route = useNavRoute()
  const dispatch = useNavigationDispatch()
  if (route.key !== 'document')
    throw new Error(
      'DocOptionsButton can only be rendered on publication route',
    )
  const {exportDocument} = useAppContext()
  const gwHost = useGatewayHost()
  const deleteEntity = useDeleteDialog()
  const doc = useEntity(route.id)
  const [copyContent, onCopy, host] = useCopyGatewayReference()
  const removeSite = useRemoveSiteDialog()
  const publishSite = usePublishSite()
  const canEditDoc = true // todo: check permissions
  const menuItems: MenuItemType[] = [
    {
      key: 'link',
      label: `Copy ${host} URL`,
      icon: Link,
      onPress: () => {
        onCopy({
          ...route.id,
        })
      },
    },
    {
      key: 'export',
      label: 'Export Document',
      icon: Download,
      onPress: async () => {
        const title = doc.data?.document?.metadata.name || 'document'
        const blocks: HMBlockNode[] | undefined = doc.data?.document?.content
        const editorBlocks = hmBlocksToEditorContent(blocks)
        const markdownWithFiles = await convertBlocksToMarkdown(editorBlocks)
        const {markdownContent, mediaFiles} = markdownWithFiles
        exportDocument(title, markdownContent, mediaFiles)
      },
    },
    {
      key: 'delete',
      label: 'Delete Publication',
      icon: Trash,
      onPress: () => {
        deleteEntity.open({
          id: route.id.id,
          title: getDocumentTitle(doc.data?.document),
          onSuccess: () => {
            dispatch({type: 'pop'})
          },
        })
      },
    },
  ]
  if (!route.id.path?.length && canEditDoc) {
    if (doc.data?.document?.metadata?.siteUrl)
      menuItems.push({
        key: 'publish-site',
        label: 'Remove Site from Publication',
        icon: CloudOff,
        color: '$red10',
        onPress: () => {
          removeSite.open(route.id)
        },
      })
    else
      menuItems.push({
        key: 'publish-site',
        label: 'Publish Site',
        icon: UploadCloud,
        onPress: () => {
          publishSite.open(route.id)
        },
      })
  }
  const docUrl = route.id
    ? packHmId(
        hmId('d', route.id.uid, {
          version: route.id.version,
        }),
      )
    : null
  // menuItems.push(useFavoriteMenuItem(docUrl))

  return (
    <>
      {copyContent}
      {deleteEntity.content}
      {publishSite.content}
      {removeSite.content}
      <OptionsDropdown menuItems={menuItems} />
    </>
  )
}

function EditDocButton() {
  const route = useNavRoute()
  if (route.key !== 'document')
    throw new Error('EditDocButton can only be rendered on document route')
  const capability = useMyCapability(route.id, 'writer')
  const navigate = useNavigate()
  const draft = useDraft(route.id)
  const hasExistingDraft = !!draft.data
  if (!capability) return null
  return (
    <>
      <Tooltip content={hasExistingDraft ? 'Resume Editing' : 'Edit'}>
        <Button
          size="$2"
          theme={hasExistingDraft ? 'yellow' : undefined}
          onPress={() => {
            navigate({
              key: 'draft',
              id: route.id,
            })
          }}
          icon={Pencil}
        >
          {hasExistingDraft ? 'Resume Editing' : 'Edit'}
        </Button>
      </Tooltip>
    </>
  )
}

export function useDocumentUrl({
  docId,
  isBlockFocused,
}: {
  docId?: UnpackedHypermediaId
  isBlockFocused: boolean
}): {
  label: string
  url: string
  onCopy: (
    blockId?: string | undefined,
    blockRange?: BlockRange | ExpandedBlockRange,
  ) => void
  content: ReactNode
} | null {
  const docEntity = useEntity(docId)
  if (!docId?.uid) return null
  const accountEntity = useEntity(hmId('d', docId?.uid!))
  const gwUrl = useGatewayUrl()
  const [copyDialogContent, onCopyPublic] = useCopyGatewayReference()
  const gwHostname = gwUrl.data
  const siteHostname = accountEntity.data?.document?.metadata?.siteUrl
  if (!docId) return null
  const url = siteHostname
    ? createSiteUrl({
        hostname: siteHostname,
        path: docId.path,
        version: docEntity.data?.document?.version,
        latest: true,
      })
    : createWebHMUrl('d', docId.uid, {
        version: docEntity.data?.document?.version,
        hostname: gwHostname,
        path: docId.path,
      })
  return {
    url,
    label: siteHostname ? 'Site Version' : 'Doc Version',
    content: copyDialogContent,
    onCopy: (
      blockId: string | undefined,
      blockRange?: BlockRange | ExpandedBlockRange | null,
    ) => {
      const focusBlockId = isBlockFocused ? docId.blockRef : null
      if (siteHostname) {
        copyTextToClipboard(url)
      } else {
        onCopyPublic({
          ...docId,
          hostname: gwHostname || null,
          version: docEntity.data?.document?.version || null,
          blockRef: blockId || focusBlockId || null,
          blockRange: blockRange || null,
          path: docId.path,
        })
      }
    },
  }
}

export function CopyReferenceButton({
  children,
  docId,
  isBlockFocused,
  copyIcon = Link,
  openIcon = ExternalLink,
  iconPosition = 'before',
  showIconOnHover = false,
  ...props
}: PropsWithChildren<
  ButtonProps & {
    docId: UnpackedHypermediaId
    isBlockFocused: boolean
    isIconAfter?: boolean
    showIconOnHover?: boolean
    copyIcon?: React.ElementType
    openIcon?: React.ElementType
    iconPosition?: 'before' | 'after'
  }
>) {
  const [shouldOpen, setShouldOpen] = useState(false)
  const reference = useDocumentUrl({docId, isBlockFocused})
  const {externalOpen} = useAppContext()
  if (!reference) return null
  const CurrentIcon = shouldOpen ? openIcon : copyIcon
  const Icon = () => (
    <CurrentIcon
      size={12}
      color="$color5"
      opacity={shouldOpen ? 1 : showIconOnHover ? 0 : 1}
      $group-item-hover={{opacity: 1, color: '$color6'}}
    />
  )
  return (
    <>
      <Tooltip
        content={
          shouldOpen
            ? `Open ${reference.label}`
            : `Copy ${reference.label} Link`
        }
      >
        <Button
          flexShrink={0}
          flexGrow={0}
          onHoverOut={() => {
            setShouldOpen(false)
          }}
          aria-label={`${shouldOpen ? 'Open' : 'Copy'} ${reference.label} Link`}
          chromeless
          size="$2"
          group="item"
          theme="brand"
          bg="$colorTransparent"
          borderColor="$colorTransparent"
          onPress={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (shouldOpen) {
              setShouldOpen(false)
              externalOpen(reference.url)
            } else {
              setShouldOpen(true)
              // in theory we should save this timeout in a ref and deal with it upon unmount. in practice it doesn't matter
              setTimeout(() => {
                setShouldOpen(false)
              }, 5000)
              reference.onCopy()
            }
          }}
          hoverStyle={{
            backgroundColor: '$colorTransparent',
            borderColor: '$colorTransparent',
            ...props.hoverStyle,
          }}
          {...props}
        >
          {iconPosition == 'before' ? <Icon /> : null}
          {children}
          {iconPosition == 'after' ? <Icon /> : null}
        </Button>
      </Tooltip>
      {reference.content}
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
    buttonGroup = [
      <EditDocButton key="editDoc" />,
      // <CreateDropdown key="create" location={route.id} />, // TODO, new path selection workflow
      <DocOptionsButton key="options" />,
    ]
  }
  return <TitlebarSection>{buttonGroup}</TitlebarSection>
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
            cursor={state.routeIndex <= 0 ? 'default' : 'pointer'}
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
            cursor={
              state.routeIndex >= state.routes.length - 1
                ? 'default'
                : 'pointer'
            }
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
  const ctx = useSidebarContext()
  const isLocked = useStream(ctx.isLocked)
  const isHoverVisible = useStream(ctx.isHoverVisible)
  let icon = Menu
  let tooltip = 'Lock Sidebar Open'
  let onPress = ctx.onLockSidebarOpen
  let key = 'lock'
  let color: undefined | ColorProp = undefined
  if (isLocked) {
    icon = ArrowLeftFromLine
    tooltip = 'Close Sidebar'
    onPress = ctx.onCloseSidebar
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
      <XStack position="relative" zIndex={1000} className="no-window-drag">
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
    </XStack>
  )
}
