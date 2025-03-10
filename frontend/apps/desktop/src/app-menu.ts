// this menu is visible on macOS only
// the keyboard shortcuts apply to every platform

import {defaultRoute} from '@shm/shared/routes'
import {Menu, MenuItem} from 'electron'
import {dispatchFocusedWindowAppEvent, openRoute, trpc} from './app-api'
import {checkForUpdates} from './auto-update'

export function createAppMenu() {
  const appMenu = new Menu()

  appMenu.append(
    new MenuItem({
      role: 'appMenu',
      label: 'Seed',
      submenu: [
        {role: 'about'},
        {type: 'separator'},
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            trpc.createAppWindow({routes: [{key: 'settings'}]})
          },
        },
        {
          label: 'Search / Open',
          accelerator: 'CmdOrCtrl+k',
          click: () => {
            dispatchFocusedWindowAppEvent('open_launcher')
          },
        },
        {type: 'separator'},
        {
          label: 'Trigger Sync with Peers',
          accelerator: 'CmdOrCtrl+Option+r',
          click: () => {
            dispatchFocusedWindowAppEvent('trigger_peer_sync')
          },
        },
        {
          label: 'Check for Updates',
          accelerator: 'CmdOrCtrl+Option+u',
          click: checkForUpdates,
        },
        {type: 'separator'},
        {role: 'services'},
        {type: 'separator'},
        {role: 'hide'},
        {role: 'hideOthers'},
        {role: 'unhide'},
        {type: 'separator'},
        {role: 'quit'},
      ],
    }),
  )
  appMenu.append(
    new MenuItem({
      role: 'fileMenu',
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            trpc.createAppWindow({routes: [defaultRoute]})
          },
        },
        {type: 'separator'},
        {role: 'close'},
      ],
    }),
  )
  appMenu.append(new MenuItem({role: 'editMenu'}))

  appMenu.append(
    new MenuItem({
      id: 'viewMenu',
      label: 'View',
      submenu: [
        {role: 'reload'},
        {role: 'forceReload'},
        {role: 'toggleDevTools'},
        {type: 'separator'},
        {
          id: 'back',
          label: 'Back',
          accelerator: 'CmdOrCtrl+Left',
          click: () => {
            dispatchFocusedWindowAppEvent('back')
          },
        },
        {
          id: 'forward',
          label: 'Forward',
          accelerator: 'CmdOrCtrl+Right',
          click: () => {
            dispatchFocusedWindowAppEvent('forward')
          },
        },
        {type: 'separator'},
        {
          id: 'route_contacts',
          label: 'Contacts',
          accelerator: 'CmdOrCtrl+9',
          click: () => {
            openRoute({
              key: 'contacts',
            })
          },
        },
        {
          id: 'route_deleted_content',
          label: 'Review Deleted Content',
          // accelerator: 'CmdOrCtrl+9',
          click: () => {
            openRoute({
              key: 'deleted-content',
            })
          },
        },
        {type: 'separator'},
        {role: 'resetZoom'},
        {role: 'zoomIn'},
        {role: 'zoomOut'},
        {type: 'separator'},
        {role: 'togglefullscreen'},
      ],
    }),
  )
  // appMenu.getMenuItemById('route_pubs').enabled = false

  appMenu.append(
    new MenuItem({
      role: 'windowMenu',
      submenu: [
        {
          role: 'minimize',
        },
      ],
    }),
  )

  return appMenu
}
