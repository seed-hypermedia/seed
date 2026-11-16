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
    show() {}
    restore() {}
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
import {hmId} from '@shm/shared/utils/entity-id-url'
import {
  createAppWindow,
  createAppWindowInputSchema,
  focusWindowForRoute,
  getAllWindows,
  getFocusedWindowNewWindowRoute,
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
    expect(getWindowNavState().new).toMatchObject({sidebarLocked: true, sidebarWidth: 22, accessoryWidth: 20})
  })
})

describe('getFocusedWindowNewWindowRoute', () => {
  it('routes to the focused window sidebar space home document', () => {
    const source = createAppWindow({id: 'source', routes: [defaultRoute]})
    source.webContents.ipc.emit('windowSidebarSpace', {}, {spaceUid: 'space-a'})
    expect(getFocusedWindowNewWindowRoute()).toEqual({key: 'document', id: hmId('space-a')})
  })

  it('falls back to the default route when the sidebar reports no space', () => {
    createAppWindow({id: 'source', routes: [defaultRoute]})
    expect(getFocusedWindowNewWindowRoute()).toEqual(defaultRoute)
  })

  it('falls back to the default route after the sidebar clears its space', () => {
    const source = createAppWindow({id: 'source', routes: [defaultRoute]})
    source.webContents.ipc.emit('windowSidebarSpace', {}, {spaceUid: 'space-a'})
    source.webContents.ipc.emit('windowSidebarSpace', {}, {spaceUid: null})
    expect(getFocusedWindowNewWindowRoute()).toEqual(defaultRoute)
  })

  it('uses the space reported by the focused window', () => {
    const first = createAppWindow({id: 'first', routes: [defaultRoute]})
    const second = createAppWindow({id: 'second', routes: [defaultRoute]})
    first.webContents.ipc.emit('windowSidebarSpace', {}, {spaceUid: 'space-a'})
    second.webContents.ipc.emit('windowSidebarSpace', {}, {spaceUid: 'space-b'})
    first.focus()
    expect(getFocusedWindowNewWindowRoute()).toEqual({key: 'document', id: hmId('space-a')})
    second.focus()
    expect(getFocusedWindowNewWindowRoute()).toEqual({key: 'document', id: hmId('space-b')})
  })

  it('does not persist the sidebar space to the window state', () => {
    const source = createAppWindow({id: 'source', routes: [defaultRoute]})
    source.webContents.ipc.emit('windowSidebarSpace', {}, {spaceUid: 'space-a'})
    expect(getWindowsState().source).not.toHaveProperty('sidebarSpaceUid')
    expect(getWindowNavState().source.sidebarSpaceUid).toBe('space-a')
  })
})

describe('duplicate window prevention', () => {
  it('focuses the window already showing the document instead of opening a new one', () => {
    const docRoute = {key: 'document', id: hmId('alice', {path: ['doc']})} as const
    const first = createAppWindow({id: 'first', routes: [docRoute]})
    const result = createAppWindow({routes: [docRoute]})
    expect(result).toBe(first)
    expect(getAllWindows().size).toBe(1)
    // The window already shows the exact route, so no navigation is sent.
    expect(first.webContents.send).not.toHaveBeenCalledWith('open_route', expect.anything())
  })

  it('navigates the existing window when the requested route differs', () => {
    const docRoute = {key: 'document', id: hmId('alice', {path: ['doc']})} as const
    const versionedRoute = {key: 'document', id: hmId('alice', {path: ['doc'], version: 'bafyv1'})} as const
    const first = createAppWindow({id: 'first', routes: [docRoute]})
    const result = createAppWindow({routes: [versionedRoute]})
    expect(result).toBe(first)
    expect(getAllWindows().size).toBe(1)
    expect(first.webContents.send).toHaveBeenCalledWith('open_route', versionedRoute)
  })

  it('still opens a new window for a different document', () => {
    const first = createAppWindow({id: 'first', routes: [{key: 'document', id: hmId('alice', {path: ['doc']})}]})
    const second = createAppWindow({routes: [{key: 'document', id: hmId('alice', {path: ['other']})}]})
    expect(second).not.toBe(first)
    expect(getAllWindows().size).toBe(2)
  })

  it('dedupes a bare draft route against the window showing that draft', () => {
    const draftDocRoute = {key: 'document', id: hmId('alice', {path: ['docs', '-d1']})} as const
    const first = createAppWindow({id: 'first', routes: [draftDocRoute]})
    const result = createAppWindow({routes: [{key: 'draft', id: 'd1'}]})
    expect(result).toBe(first)
    expect(getAllWindows().size).toBe(1)
  })

  it('dedupes an edit-draft route against the window showing the published document', () => {
    const docRoute = {key: 'document', id: hmId('alice', {path: ['doc']})} as const
    const first = createAppWindow({id: 'first', routes: [docRoute]})
    const result = createAppWindow({routes: [{key: 'draft', id: 'd1', editUid: 'alice', editPath: ['doc']}]})
    expect(result).toBe(first)
    expect(getAllWindows().size).toBe(1)
  })

  it('still refocuses singleton windows like settings', () => {
    const first = createAppWindow({id: 'first', routes: [{key: 'settings'}]})
    const result = createAppWindow({routes: [{key: 'settings'}]})
    expect(result).toBe(first)
    expect(getAllWindows().size).toBe(1)
  })
})

describe('focusWindowForRoute', () => {
  it('focuses the window showing the resource and reports handled', () => {
    const docRoute = {key: 'document', id: hmId('alice', {path: ['doc']})} as const
    const otherRoute = {key: 'document', id: hmId('alice', {path: ['other']})} as const
    const first = createAppWindow({id: 'first', routes: [docRoute]})
    createAppWindow({id: 'second', routes: [otherRoute]})
    expect(focusWindowForRoute(docRoute, 'second')).toBe(true)
    // Same route already shown: focused only, no extra navigation.
    expect(first.webContents.send).not.toHaveBeenCalledWith('open_route', expect.anything())
  })

  it('returns false when only the requesting window shows the resource', () => {
    const docRoute = {key: 'document', id: hmId('alice', {path: ['doc']})} as const
    createAppWindow({id: 'first', routes: [docRoute]})
    expect(focusWindowForRoute(docRoute, 'first')).toBe(false)
  })

  it('returns false for routes no window shows', () => {
    createAppWindow({id: 'first', routes: [defaultRoute]})
    expect(focusWindowForRoute({key: 'document', id: hmId('alice')}, 'first')).toBe(false)
  })
})
