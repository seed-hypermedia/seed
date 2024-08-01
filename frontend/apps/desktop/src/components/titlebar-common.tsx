import {useAppContext} from '@/app-context'
import {ContactsPrompt} from '@/components/contacts-prompt'
import {useCopyGatewayReference} from '@/components/copy-gateway-reference'
import {useDeleteDialog} from '@/components/delete-dialog'
import {MenuItemType, OptionsDropdown} from '@/components/options-dropdown'
// import {DraftPublicationButtons} from '@/components/variants'
import {useDraft} from '@/models/accounts'
import {useMyAccountIds} from '@/models/daemon'
import {usePushPublication} from '@/models/documents'
import {useEntity} from '@/models/entities'
import {useGatewayHost, useGatewayUrl} from '@/models/gateway-settings'
import {SidebarWidth, useSidebarContext} from '@/sidebar-context'
import {
  useNavRoute,
  useNavigationDispatch,
  useNavigationState,
} from '@/utils/navigation'
import {useOpenDraft} from '@/utils/open-draft'
import {NavRoute} from '@/utils/routes'
import {useNavigate} from '@/utils/useNavigate'
import {
  BlockRange,
  ExpandedBlockRange,
  HYPERMEDIA_ENTITY_TYPES,
  createPublicWebHmUrl,
  getDocumentTitle,
  hmId,
  packHmId,
} from '@shm/shared'
import {
  Back,
  Button,
  ColorProp,
  Forward,
  Menu,
  TitlebarSection,
  Tooltip,
  View,
  XGroup,
  XStack,
  copyUrlToClipboardWithFeedback,
  toast,
  useStream,
} from '@shm/ui'
import {
  ArrowLeftFromLine,
  ArrowRightFromLine,
  ExternalLink,
  FilePlus2,
  Link,
  Pencil,
  Trash,
  UploadCloud,
} from '@tamagui/lucide-icons'
import {ReactNode, useState} from 'react'
import DiscardDraftButton from './discard-draft-button'
import PublishDraftButton from './publish-draft-button'
import {TitleBarProps} from './titlebar'

export function DocOptionsButton() {
  const route = useNavRoute()
  const dispatch = useNavigationDispatch()
  if (route.key !== 'document')
    throw new Error(
      'DocOptionsButton can only be rendered on publication route',
    )
  const gwHost = useGatewayHost()
  const push = usePushPublication()
  const deleteEntity = useDeleteDialog()
  const [copyContent, onCopy, host] = useCopyGatewayReference()
  const doc = useEntity(route.id)
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
      key: 'push',
      label: 'Push to Gateway',
      icon: UploadCloud,
      onPress: () => {
        toast.promise(push.mutateAsync(route.id.id), {
          loading: 'Pushing...',
          success: `Pushed to ${gwHost}`,
          error: (err) => `Could not push to ${gwHost}: ${err.message}`,
        })
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
      <OptionsDropdown menuItems={menuItems} />
    </>
  )
}

function EditDocButton() {
  const route = useNavRoute()
  if (route.key !== 'document')
    throw new Error('EditDocButton can only be rendered on document route')
  const myAccountIds = useMyAccountIds()
  const navigate = useNavigate()
  const draft = useDraft(route.id.id)
  if (route.tab !== 'home' && route.tab) return null
  const hasExistingDraft = !!draft.data
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

export function useFullReferenceUrl(route: NavRoute): {
  label: string
  url: string
  onCopy: (
    blockId?: string | undefined,
    blockRange?: BlockRange | ExpandedBlockRange,
  ) => void
  content: ReactNode
} | null {
  const docRoute = route.key === 'document' ? route : null
  const pub = useEntity(docRoute?.id)
  const gwUrl = useGatewayUrl()
  const [copyDialogContent, onCopyPublic] = useCopyGatewayReference()

  if (docRoute) {
    if (!docRoute.id) return null
    let hostname = gwUrl.data
    return {
      url: createPublicWebHmUrl('d', docRoute.id.uid, {
        version: pub.data?.document?.version,
        hostname,
      }),
      label: hostname ? 'Site Version' : 'Doc Version',
      content: copyDialogContent,
      onCopy: (
        blockId: string | undefined,
        blockRange?: BlockRange | ExpandedBlockRange | null,
      ) => {
        const focusBlockId = docRoute.isBlockFocused
          ? docRoute.id.blockRef
          : null
        onCopyPublic({
          ...docRoute.id,
          hostname: hostname || null,
          version: pub.data?.document?.version || null,
          blockRef: blockId || focusBlockId || null,
          blockRange,
        })
      },
    }
  }

  const reference = getReferenceUrlOfRoute(route, gwUrl.data)
  if (!reference) return null
  return {
    ...reference,
    content: null,
    onCopy: () => {
      copyUrlToClipboardWithFeedback(reference.url, reference.label)
    },
  }
}

function getReferenceUrlOfRoute(
  route: NavRoute,
  hostname?: string | undefined,
  exactVersion?: string | undefined,
) {
  if (route.key === 'document') {
    const url = createPublicWebHmUrl(route.id.type, route.id.uid, {
      version: exactVersion || route.id.version,
      hostname,
    })
    if (!url) return null
    return {
      label: HYPERMEDIA_ENTITY_TYPES[route.id.type],
      url,
    }
  }
  return null
}

export function CopyReferenceButton() {
  const [shouldOpen, setShouldOpen] = useState(false)
  const route = useNavRoute()
  const reference = useFullReferenceUrl(route)
  const {externalOpen} = useAppContext()
  if (!reference) return null
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
          onHoverOut={() => {
            setShouldOpen(false)
          }}
          aria-label={`${shouldOpen ? 'Open' : 'Copy'} ${reference.label} Link`}
          chromeless
          size="$2"
          icon={shouldOpen ? ExternalLink : Link}
          onPress={() => {
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
        />
      </Tooltip>
      {reference.content}
    </>
  )
}

function CreateDropdown({}: {}) {
  const openDraft = useOpenDraft('push')
  return (
    <Button
      size="$2"
      icon={FilePlus2}
      onPress={() => {
        openDraft()
      }}
    >
      Create
    </Button>
  )
}

export function PageActionButtons(props: TitleBarProps) {
  const route = useNavRoute()

  let buttonGroup: ReactNode[] = [<CreateDropdown key="create" />]
  if (route.key === 'draft') {
    buttonGroup = [<DraftPublicationButtons key="draftPublication" />]
  } else if (route.key == 'contacts') {
    buttonGroup = [
      <ContactsPrompt key="addContact" />,
      <CreateDropdown key="create" />,
    ]
  } else if (route.key === 'document' && route.id.type === 'd') {
    buttonGroup = [
      <EditDocButton key="editDoc" />,
      // <VersionContext key="versionContext" route={route} />,
      <CreateDropdown key="create" />,
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
  return (
    <>
      <PublishDraftButton />
      <DiscardDraftButton />
    </>
  )
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
