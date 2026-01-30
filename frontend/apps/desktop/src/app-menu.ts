// this menu is visible on macOS only
// the keyboard shortcuts apply to every platform

import {ipcMain, Menu, MenuItem} from 'electron'
import {nanoid} from 'nanoid'
import {dispatchFocusedWindowAppEvent, openRoute, trpc} from './app-api'
import {getFocusedWindow} from './app-windows'
import {checkForUpdates} from './auto-update'
import {isProfilerEnabled, createProfilerWindow} from './memory-profiler-window'

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
            dispatchFocusedWindowAppEvent({
              type: 'focus_omnibar',
              mode: 'search',
            })
          },
        },
        {
          label: 'Focus Address Bar',
          accelerator: 'CmdOrCtrl+l',
          click: () => {
            dispatchFocusedWindowAppEvent({type: 'focus_omnibar', mode: 'url'})
          },
        },
        {type: 'separator'},
        {
          label: 'Reindex the Database',
          click: () => {
            dispatchFocusedWindowAppEvent({type: 'trigger_database_reindex'})
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
          label: 'New Document',
          accelerator: 'CmdOrCtrl+Alt+N',
          click: () => {
            // Get the initial route to create a draft document
            trpc.createAppWindow({
              routes: [{key: 'draft', id: nanoid(10), panel: {key: 'options'}}],
            })
          },
        },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            ipcMain.emit('new_window')
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
        ...(isProfilerEnabled()
          ? [
              {
                label: 'Open Memory Profiler',
                accelerator: 'CmdOrCtrl+Shift+M',
                click: () => {
                  createProfilerWindow()
                },
              },
            ]
          : []),
        {type: 'separator'},
        {
          id: 'back',
          label: 'Back',
          accelerator: 'CmdOrCtrl+Left',
          click: () => {
            dispatchFocusedWindowAppEvent({type: 'back'})
          },
        },
        {
          id: 'forward',
          label: 'Forward',
          accelerator: 'CmdOrCtrl+Right',
          click: () => {
            dispatchFocusedWindowAppEvent({type: 'forward'})
          },
        },
        {type: 'separator'},
        {
          id: 'toggle_sidebar',
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            // Dispatch both events - handlers check editor focus
            console.log(
              '[app-menu] Cmd+B pressed, dispatching toggle_bold and toggle_sidebar',
            )
            dispatchFocusedWindowAppEvent({type: 'toggle_bold'})
            dispatchFocusedWindowAppEvent({type: 'toggle_sidebar'})
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
          accelerator: 'CmdOrCtrl+M',
        },
        {
          label: 'Maximize',
          accelerator: 'CmdOrCtrl+Up',
          click: () => {
            const window = getFocusedWindow()
            if (window) {
              if (window.isMaximized()) {
                window.unmaximize()
              } else {
                window.maximize()
              }
            }
          },
        },
        {
          label: 'Hide',
          accelerator: 'CmdOrCtrl+H',
          click: () => {
            getFocusedWindow()?.hide()
          },
        },
      ],
    }),
  )

  return appMenu
}
