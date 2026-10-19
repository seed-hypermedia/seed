import {beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('electron', async () => {
  const {EventEmitter} = await import('node:events')
  class BrowserWindow extends EventEmitter {
    static focused: BrowserWindow | null = null
    static getFocusedWindow() {
      return this.focused
    }
    webContents = Object.assign(new EventEmitter(), {
      ipc: new EventEmitter(),
      setWindowOpenHandler: vi.fn(),
      send: vi.fn(),
    })
    constructor(public bounds: Record<string, number>) {
      super()
    }
    getBounds() {
      return this.bounds
    }
    isDestroyed() {
      return false
    }
    isFullScreen() {
      return false
    }
    isMaximized() {
      return false
    }
    isMinimized() {
      return false
    }
    focus() {
      BrowserWindow.focused = this
      this.emit('focus')
    }
    close() {
      if (BrowserWindow.focused === this) BrowserWindow.focused = null
      this.emit('close')
    }
    loadURL() {}
    loadFile() {}
  }
  return {
    BrowserWindow,
    app: Object.assign(new EventEmitter(), {isReady: () => true}),
    nativeTheme: new EventEmitter(),
    globalShortcut: {register: vi.fn(), unregister: vi.fn()},
    screen: {getAllDisplays: () => [{workArea: {x: 0, y: 0, width: 4000, height: 3000}}]},
  }
})
vi.mock('../errors', () => ({default: vi.fn()}))
vi.mock('../app-web-browser', () => ({setupWebBrowser: vi.fn(), getPageWebContents: vi.fn()}))
vi.mock('../app-window-security', () => ({installWindowGuards: vi.fn()}))
vi.mock('../app-focus', () => ({markAppWindowFocused: vi.fn(), markAppWindowBlurred: vi.fn()}))
vi.mock('../app-recents', () => ({updateRecentRoute: vi.fn()}))
vi.mock('../app-settings', () => ({getAppTheme: () => 'light', shouldUseDarkColors: () => false}))
vi.mock('../app-store.mjs', () => ({appStore: {get: vi.fn(), set: vi.fn()}}))
vi.mock('../daemon', () => ({getDaemonState: () => ({}), subscribeDaemonState: () => () => {}}))
vi.mock('../logger', () => ({
  isQuietNodeLogsEnabled: () => true,
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))
vi.mock('../memory-profiler-window', () => ({logWindowOpen: vi.fn(), logWindowClose: vi.fn()}))

import {defaultRoute} from '@shm/shared/routes'
import {
  createAppWindow,
  createAppWindowInputSchema,
  getAllWindows,
  getWindowNavState,
  getWindowsState,
} from '../app-windows'

beforeEach(() => {
  getAllWindows().forEach((window) => window.close())
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', 'http://test.invalid')
})

describe('new window state', () => {
  it('keeps omitted layout inputs absent until the focused window is known', () => {
    const input = createAppWindowInputSchema.parse({routes: [defaultRoute]})
    expect(input.sidebarLocked).toBeUndefined()
    expect(input.sidebarWidth).toBeUndefined()
    expect(input.accessoryWidth).toBeUndefined()
  })

  it('inherits the latest focused layout without replacing the requested route', () => {
    const source = createAppWindow({routes: [defaultRoute]})
    source.webContents.ipc.emit(
      'windowNavState',
      {},
      {
        routes: [defaultRoute],
        routeIndex: 0,
        sidebarLocked: false,
        sidebarWidth: 23,
        accessoryWidth: 31,
      },
    )
    const route = {key: 'contacts'} as const
    createAppWindow(createAppWindowInputSchema.parse({id: 'new', routes: [route]}))
    expect(getWindowNavState().new).toMatchObject({
      routes: [route],
      routeIndex: 0,
      sidebarLocked: false,
      sidebarWidth: 23,
      accessoryWidth: 31,
    })
    expect(getWindowsState().new).toMatchObject({sidebarLocked: false, sidebarWidth: 23, accessoryWidth: 31})
  })

  it('uses the focused window rather than the last created window', () => {
    const first = createAppWindow({routes: [defaultRoute], sidebarWidth: 21})
    createAppWindow({routes: [defaultRoute], sidebarWidth: 32})
    first.focus()
    createAppWindow({id: 'new', routes: [defaultRoute]})
    expect(getWindowNavState().new.sidebarWidth).toBe(21)
  })

  it('preserves explicit restoration values and keeps windows independent', () => {
    createAppWindow({id: 'source', routes: [defaultRoute], sidebarLocked: false, sidebarWidth: 29})
    const restored = createAppWindow(
      createAppWindowInputSchema.parse({
        id: 'restored',
        routes: [defaultRoute],
        sidebarLocked: true,
        sidebarWidth: 17,
        accessoryWidth: 26,
      }),
    )
    expect(getWindowNavState().restored).toMatchObject({sidebarLocked: true, sidebarWidth: 17, accessoryWidth: 26})
    restored.webContents.ipc.emit(
      'windowNavState',
      {},
      {
        routes: [defaultRoute],
        routeIndex: 0,
        sidebarLocked: false,
        sidebarWidth: 35,
        accessoryWidth: 26,
      },
    )
    expect(getWindowNavState().source.sidebarWidth).toBe(29)
  })

  it('uses defaults when there is no source window', () => {
    createAppWindow({id: 'new', routes: [defaultRoute]})
    expect(getWindowNavState().new).toMatchObject({sidebarLocked: true, sidebarWidth: 15, accessoryWidth: 20})
  })
})
