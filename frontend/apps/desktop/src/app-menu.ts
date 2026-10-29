// this menu is visible on macOS only
// the keyboard shortcuts apply to every platform

import {BrowserWindow, ipcMain, Menu, MenuItem, webContents, type WebFrameMain} from 'electron'
import {isDocumentPageURL} from '@shm/shared/document-page'
import {dispatchFocusedWindowAppEvent, openRoute, trpc} from './app-api'
import {getFocusedWindow} from './app-windows'
import {checkForUpdates} from './auto-update'
import {isProfilerEnabled, createProfilerWindow} from './memory-profiler-window'

function reloadFocusedPage(ignoreCache: boolean) {
  const contents = webContents.getFocusedWebContents() || getFocusedWindow()?.webContents
  if (!contents || contents.isDestroyed()) return
  // Focus may be inside a nested frame. Reload the enclosing HTML app, not Seed or a widget within it.
  let page: WebFrameMain | undefined
  for (let frame = contents.focusedFrame; frame && frame !== contents.mainFrame; frame = frame.parent) {
    if (frame.isDestroyed() || frame.detached) return
    if (isDocumentPageURL(frame.url)) page = frame
  }
  if (page) {
    // seed-page responses use Cache-Control: no-store, including on a force refresh.
    page.reload()
  } else if (ignoreCache) contents.reloadIgnoringCache()
  else contents.reload()
}

/** Build the native menu and keyboard shortcuts, routing refresh to the focused app or HTML page. */
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
          click: () => checkForUpdates(),
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
            dispatchFocusedWindowAppEvent({type: 'create_new_document'})
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
  appMenu.append(
    new MenuItem({
      label: 'Edit',
      submenu: [
        {role: 'undo'},
        {role: 'redo'},
        {type: 'separator'},
        {role: 'cut'},
        {role: 'copy'},
        {role: 'paste'},
        {role: 'pasteAndMatchStyle'},
        {role: 'delete'},
        {type: 'separator'},
        {
          label: 'Select All',
          click: (_menuItem, browserWindow) => {
            if (browserWindow instanceof BrowserWindow) browserWindow.webContents.selectAll()
          },
        },
      ],
    }),
  )

  appMenu.append(
    new MenuItem({
      id: 'viewMenu',
      label: 'View',
      submenu: [
        {id: 'reload', label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => reloadFocusedPage(false)},
        {
          id: 'forceReload',
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => reloadFocusedPage(true),
        },
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
        {
          id: 'go_to_parent',
          label: 'Go to Parent',
          accelerator: 'CmdOrCtrl+Up',
          click: () => {
            dispatchFocusedWindowAppEvent({type: 'go_to_parent'})
          },
        },
        {type: 'separator'},
        {
          id: 'toggle_sidebar',
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
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
          id: 'route_agents',
          label: 'Agents',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => {
            openRoute({
              key: 'agents',
            })
          },
        },
        {
          id: 'route_api_inspector',
          label: 'API Inspector',
          click: () => {
            openRoute({
              key: 'api-inspector',
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
