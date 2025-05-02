import {useIPC, useWindowUtils} from '@/app-context'
import {WindowsLinuxWindowControls} from '@/components/window-controls'
import {useNavRoute, useNavigationDispatch} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {useTriggerWindowEvent} from '@/utils/window-events'
import {defaultRoute} from '@shm/shared/routes'
import {Button} from '@shm/ui/button'
import {
  AddSquare,
  Close,
  CloseAll,
  Contact,
  Delete,
  Hide,
  Reload,
  Search,
  Settings,
} from '@shm/ui/icons'
import {TitlebarRow, TitlebarSection, TitlebarWrapper} from '@shm/ui/titlebar'
import {nanoid} from 'nanoid'
import {useMemo} from 'react'
import {
  ListItem,
  ListItemProps,
  Popover,
  Separator,
  SizableText,
  XStack,
  YGroup,
} from 'tamagui'

export function WindowsLinuxTitleBar({
  left,
  title,
  right,
}: {
  title: React.ReactNode
  left?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <TitlebarWrapper className="window-drag" style={{flex: 'none'}}>
      <TitlebarRow
        minHeight={28}
        backgroundColor="$color3"
        className="window-drag"
      >
        <TitlebarSection>
          <SystemMenu />
        </TitlebarSection>
        <XStack flex={1} className="window-drag" />
        <TitlebarSection>
          <WindowsLinuxWindowControls />
        </TitlebarSection>
      </TitlebarRow>
      <TitlebarRow className="window-drag">
        <XStack
          flex={1}
          minWidth={'min-content'}
          flexBasis={0}
          alignItems="center"
          className="window-drag"
        >
          {left}
        </XStack>
        <XStack
          f={1}
          alignItems="center"
          justifyContent="center"
          pointerEvents="none"
          height="100%"
          ai="center"
          jc="center"
        >
          {title}
        </XStack>
        <XStack
          flex={1}
          justifyContent="flex-end"
          minWidth={'min-content'}
          flexBasis={0}
          className="window-drag"
          alignItems="center"
        >
          {right}
        </XStack>
      </TitlebarRow>
    </TitlebarWrapper>
  )
}

export function SystemMenu() {
  const createDraft = useNavigate('spawn')
  const {hide, close, quit, minimize, maximize, unmaximize, isMaximized} =
    useWindowUtils()
  const spawn = useNavigate('spawn')
  const push = useNavigate('push')
  const navDispatch = useNavigationDispatch()
  const route = useNavRoute()
  const triggerFocusedWindow = useTriggerWindowEvent()
  const {invoke} = useIPC()
  const menuItems = useMemo<MenuItemElement[]>(
    () =>
      [
        {
          id: 'seed',
          title: 'Seed',
          children: [
            {
              id: 'preferences',
              title: 'Preferences...',
              accelerator: 'Ctrl+,',
              onSelect: () => spawn({key: 'settings'}),
              icon: Settings,
            },
            {id: 'separator'},
            {
              id: 'quickswitcher',
              title: 'Search / Open',
              accelerator: 'Ctrl+K',
              onSelect: () => triggerFocusedWindow('open_launcher'),
              icon: Search,
            },
            {
              id: 'forcesync',
              title: 'Trigger sync with Peers',
              accelerator: 'Opt+Ctrl+R',
              onSelect: () => triggerFocusedWindow('trigger_peer_sync'),
            },
            {
              id: 'app-update',
              title: 'Check for Updates',
              onSelect: () => window.autoUpdate?.checkForUpdates(),
            },
            {id: 'separator'},
            {
              id: 'hide',
              title: 'Hide',
              accelerator: 'Ctrl+H',
              onSelect: () => hide(),
              icon: Hide,
            },
            {
              id: 'quit',
              title: 'Quit Seed',
              onSelect: () => quit(),
              icon: Delete,
            },
          ],
        },
        {
          title: 'File',
          id: 'file',
          children: [
            {
              id: 'newdocument',
              title: 'New Document',
              accelerator: 'Ctrl+Alt+N',
              onSelect: () =>
                createDraft({
                  key: 'draft',
                  id: nanoid(10),
                }),
              icon: AddSquare,
            },
            {
              id: 'newwindow',
              title: 'New Window',
              accelerator: 'Ctrl+Shift+N',
              onSelect: () => spawn(defaultRoute),
              icon: AddSquare,
            },
            {id: 'separator'},
            {
              id: 'minimize',
              title: 'Minimize Window',
              accelerator: 'Ctrl+M',
              onSelect: minimize,
            },
            {
              id: 'maximize',
              title: 'Maximize Window',
              accelerator: 'Ctrl+Up',
              onSelect: () => {
                if (isMaximized) {
                  unmaximize()
                } else {
                  maximize()
                }
              },
            },
            {id: 'separator'},
            {
              id: 'close',
              title: 'Close Window  ',
              accelerator: 'Ctrl+F4',
              onSelect: () => close(),
              icon: Close,
            },
            {
              id: 'closeallwindows',
              title: 'Close all Windows',
              accelerator: 'Ctrl+Shift+Alt+W',
              onSelect: () => invoke('close_all_windows'),
              icon: CloseAll,
            },
          ],
        },
        {
          id: 'view',
          title: 'View',
          children: [
            {
              id: 'back',
              title: 'Back',
              accelerator: 'Ctrl+◀︎',
              onSelect: () => navDispatch({type: 'pop'}),
            },
            {
              id: 'forward',
              title: 'Forward',
              accelerator: 'Ctrl+▶︎',
              onSelect: () => navDispatch({type: 'forward'}),
            },
            {
              id: 'contacts',
              title: 'Contacts',
              accelerator: 'Ctrl+9',
              onSelect: () => push({key: 'contacts'}),
              icon: Contact,
              disabled: route.key == 'contacts',
            },
            {
              id: 'reload',
              title: 'Reload',
              accelerator: 'Ctrl+R',
              onSelect: () => window.location.reload(),
              icon: Reload,
            },
            {
              id: 'forcereload',
              title: 'Force Reload',
              accelerator: 'Ctrl+Shift+R',
              onSelect: () => window.location.reload(),
              icon: Reload,
            },
            {
              id: 'discover',
              title: 'Discover current Document',
              accelerator: 'Ctrl+D',
              disabled: route.key != 'document',
              onSelect: () => triggerFocusedWindow('discover'),
            },
          ],
        },
      ] as MenuItemElement[],
    [
      createDraft,
      close,
      hide,
      invoke,
      spawn,
      triggerFocusedWindow,
      route.key,
      navDispatch,
      push,
    ],
  )

  return (
    <XStack className="no-window-drag" paddingLeft="$2">
      {menuItems.map((item) => (
        <Popover key={item.id} placement="bottom-start">
          <Popover.Trigger asChild>
            <Button
              size="$1"
              backgroundColor="transparent"
              borderRadius={0}
              paddingHorizontal="$2"
              fontWeight={item.id == 'seed' ? 'bold' : undefined}
            >
              {item.title}
            </Button>
          </Popover.Trigger>
          <Popover.Content
            className="no-window-drag"
            padding={0}
            elevation="$2"
            enterStyle={{y: -10, opacity: 0}}
            exitStyle={{y: -10, opacity: 0}}
            elevate
            animation={[
              'fast',
              {
                opacity: {
                  overshootClamping: true,
                },
              },
            ]}
          >
            <YGroup>
              {item.children.map((p) => {
                if (p.id == 'separator') {
                  return (
                    <YGroup.Item key={p.id}>
                      <Separator />
                    </YGroup.Item>
                  )
                } else {
                  return (
                    <YGroup.Item key={p.id}>
                      <ListItem
                        className="no-window-drag"
                        icon={(p as SubMenuItemElement).icon}
                        hoverTheme
                        pressTheme
                        hoverStyle={{
                          backgroundColor: '$backgroundFocus',
                        }}
                        paddingHorizontal="$3"
                        paddingVertical="$1"
                        backgroundColor="transparent"
                        onPress={(p as SubMenuItemElement).onSelect}
                        size="$2"
                        disabled={(p as SubMenuItemElement).disabled}
                      >
                        <SizableText fontSize="$1" flex={1}>
                          {(p as SubMenuItemElement).title}
                        </SizableText>
                        {(p as SubMenuItemElement).accelerator && (
                          <SizableText
                            marginLeft="$2"
                            fontSize="$1"
                            color={'$color9'}
                          >
                            {(p as SubMenuItemElement).accelerator}
                          </SizableText>
                        )}
                      </ListItem>
                    </YGroup.Item>
                  )
                }
              })}
            </YGroup>
          </Popover.Content>
        </Popover>
      ))}
    </XStack>
  )
}

type MenuItemElement = {
  id: string
  title: string
  children: Array<SubMenuItemElement | {id: 'separator'}>
}

type SubMenuItemElement = {
  id: string
  title: string
  onSelect: () => void
  icon?: ListItemProps['icon']
  accelerator?: string
  disabled?: boolean
}
