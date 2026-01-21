import {useIPC, useWindowUtils} from '@/app-context'
import {WindowsLinuxWindowControls} from '@/components/window-controls'
import {useNavigate} from '@/utils/useNavigate'
import {useTriggerWindowEvent} from '@/utils/window-events'
import {defaultRoute} from '@shm/shared/routes'
import {useNavRoute, useNavigationDispatch} from '@shm/shared/utils/navigation'
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '@shm/ui/components/menubar'
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
      <TitlebarRow>
        <TitlebarSection>
          <SystemMenu />
        </TitlebarSection>
        <div className="window-drag flex flex-1" />
        <TitlebarSection>
          <WindowsLinuxWindowControls />
        </TitlebarSection>
      </TitlebarRow>
      <TitlebarRow className="window-drag">
        <div className="window-drag flex min-w-min flex-none items-center">
          {left}
        </div>
        <div className="pointer-events-none flex h-full flex-1 items-center justify-center">
          {title}
        </div>
        <div className="window-drag flex min-w-min flex-none items-center justify-end">
          {right}
        </div>
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
              icon: <Settings className="size-4" />,
            },
            {id: 'separator'},
            {
              id: 'quickswitcher',
              title: 'Search / Open',
              accelerator: 'Ctrl+K',
              onSelect: () => triggerFocusedWindow({type: 'open_launcher'}),
              icon: <Search className="size-4" />,
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
              icon: <Hide className="size-4" />,
            },
            {
              id: 'quit',
              title: 'Quit Seed',
              onSelect: () => quit(),
              icon: <Delete className="size-4" />,
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
              icon: <AddSquare className="size-4" />,
            },
            {
              id: 'newwindow',
              title: 'New Window',
              accelerator: 'Ctrl+Shift+N',
              onSelect: () => spawn(defaultRoute),
              icon: <AddSquare className="size-4" />,
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
              icon: <Close className="size-4" />,
            },
            {
              id: 'closeallwindows',
              title: 'Close all Windows',
              accelerator: 'Ctrl+Shift+Alt+W',
              onSelect: () => invoke('close_all_windows'),
              icon: <CloseAll className="size-4" />,
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
              icon: <Contact className="size-4" />,
              disabled: route.key == 'contacts',
            },
            {
              id: 'reload',
              title: 'Reload',
              accelerator: 'Ctrl+R',
              onSelect: () => window.location.reload(),
              icon: <Reload className="size-4" />,
            },
            {
              id: 'forcereload',
              title: 'Force Reload',
              accelerator: 'Ctrl+Shift+R',
              onSelect: () => window.location.reload(),
              icon: <Reload className="size-4" />,
            },
            {
              id: 'discover',
              title: 'Discover current Document',
              accelerator: 'Ctrl+D',
              disabled: route.key != 'document',
              onSelect: () => triggerFocusedWindow({type: 'discover'}),
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
    <div className="no-window-drag flex pl-2">
      <Menubar>
        {menuItems.map((item: MenuItemElement) => (
          <MenubarMenu key={item.id}>
            <MenubarTrigger className="font-bold">{item.title}</MenubarTrigger>
            <MenubarContent>
              {item.children.map(
                (p: SubMenuItemElement | {id: 'separator'}) => {
                  if (p.id == 'separator') {
                    return <MenubarSeparator key={p.id} />
                  } else {
                    let item: SubMenuItemElement = p as SubMenuItemElement
                    return (
                      <MenubarItem
                        onClick={item.onSelect}
                        disabled={item.disabled}
                      >
                        {item.title}
                        {item.accelerator && (
                          <MenubarShortcut>{item.accelerator}</MenubarShortcut>
                        )}
                      </MenubarItem>
                    )
                  }
                },
              )}
            </MenubarContent>
          </MenubarMenu>
        ))}
      </Menubar>
    </div>
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
  icon?: React.ReactNode
  accelerator?: string
  disabled?: boolean
}
