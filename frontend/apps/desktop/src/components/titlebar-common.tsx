import {useAppContext} from '@/app-context'
import {useCopyReferenceUrl} from '@/components/copy-reference-url'
import {useDeleteDialog} from '@/components/delete-dialog'
import {roleCanWrite, useMyCapability} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {useEntity} from '@/models/entities'
import {useGatewayUrl} from '@/models/gateway-settings'
import {SidebarContext, SidebarWidth} from '@/sidebar-context'
import {convertBlocksToMarkdown} from '@/utils/blocks-to-markdown'
import {
  useNavRoute,
  useNavigationDispatch,
  useNavigationState,
} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {
  DEFAULT_GATEWAY_URL,
  HMBlockNode,
  displayHostname,
  hmBlocksToEditorContent,
  hmId,
} from '@shm/shared'
import {
  Back,
  Button,
  ColorProp,
  Forward,
  Menu,
  MenuItemType,
  OptionsDropdown,
  SizableText,
  TitlebarSection,
  Tooltip,
  View,
  XGroup,
  XStack,
  YStack,
  toast,
  useStream,
} from '@shm/ui'
import {
  ArrowLeftFromLine,
  ArrowRight,
  ArrowRightFromLine,
  CloudOff,
  Download,
  Link,
  Pencil,
  Trash,
  UploadCloud,
  UserPlus,
} from '@tamagui/lucide-icons'
import {ReactNode, useContext} from 'react'
import {AddConnectionDialog} from './contacts-prompt'
import {useAppDialog} from './dialog'
import DiscardDraftButton from './discard-draft-button'
import {FavoriteButton} from './favoriting'
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
  const {exportDocument, openDirectory} = useAppContext()
  const deleteEntity = useDeleteDialog()
  const gwUrl = useGatewayUrl().data || DEFAULT_GATEWAY_URL
  const doc = useEntity(route.id)
  const rootEntity = useEntity(hmId('d', route.id.uid))
  const siteUrl = rootEntity.data?.document?.metadata.siteUrl
  const [copyGatewayContent, onCopyGateway] = useCopyReferenceUrl(gwUrl)
  const [copySiteUrlContent, onCopySiteUrl] = useCopyReferenceUrl(
    siteUrl || gwUrl,
  )
  const removeSite = useRemoveSiteDialog()
  const publishSite = usePublishSite()
  const capability = useMyCapability(route.id)
  const canEditDoc = roleCanWrite(capability?.role)

  const menuItems: MenuItemType[] = [
    {
      key: 'link',
      label: `Copy ${displayHostname(gwUrl)} URL`,
      icon: Link,
      onPress: () => {
        onCopyGateway(route.id)
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
      label: `Copy ${displayHostname(siteUrl)} URL`,
      icon: Link,
      onPress: () => {
        onCopySiteUrl(route.id)
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
  return (
    <>
      {copyGatewayContent}
      {copySiteUrlContent}
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
  const capability = useMyCapability(route.id)
  const {data: entity} = useEntity(route.id)
  const navigate = useNavigate()
  const draft = useDraft(route.id)
  const hasExistingDraft = !!draft.data
  if (!roleCanWrite(capability?.role)) return null
  return (
    <>
      <Tooltip content={hasExistingDraft ? 'Resume Editing' : 'Edit'}>
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
      </Tooltip>
    </>
  )
}

export function PageActionButtons(props: TitleBarProps) {
  const route = useNavRoute()
  const connectDialog = useAppDialog(AddConnectionDialog)
  const favoriteButton =
    route.key === 'document' ? <FavoriteButton id={route.id} /> : null
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
      <LatestVersionButton />,
      favoriteButton,
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

function LatestVersionButton() {
  const route = useNavRoute()
  const latestDoc = useEntity(
    route.key == 'document' ? {...route.id, version: null} : undefined,
  )
  const navigate = useNavigate('push')

  if (
    route.key != 'document' ||
    !route.id.version ||
    route.id.latest ||
    latestDoc.data?.id?.version == route.id.version
  ) {
    return null
  }

  return (
    <Button
      bg="$brand12"
      borderColor="$brand11"
      hoverStyle={{bg: '$brand11', borderColor: '$brand10'}}
      size="$2"
      iconAfter={ArrowRight}
      onPress={() => {
        if (latestDoc.data?.id) {
          navigate({
            key: 'document',
            id: {...latestDoc.data.id, version: null},
            accessory: route.accessory,
          })
        }
      }}
    >
      Latest Version
    </Button>
  )
}
