// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest'

const focus = vi.hoisted(() => ({contents: null as any, window: null as any}))
vi.mock('electron', () => {
  class Menu {
    items: any[] = []
    append(item: any) {
      this.items.push(item)
    }
    getMenuItemById(id: string): any {
      return (
        this.items.find((item) => item.id === id) ||
        this.items.flatMap((item) => item.submenu?.items || []).find((item) => item.id === id)
      )
    }
  }
  class MenuItem {
    constructor(options: any) {
      Object.assign(this, options)
      if (options.submenu) Object.assign(this, {submenu: Object.assign(new Menu(), {items: options.submenu})})
    }
  }
  return {
    Menu,
    MenuItem,
    BrowserWindow: class {},
    ipcMain: {},
    webContents: {getFocusedWebContents: () => focus.contents},
  }
})
vi.mock('../app-api', () => ({dispatchFocusedWindowAppEvent: vi.fn(), openRoute: vi.fn(), trpc: {}}))
vi.mock('../app-windows', () => ({getFocusedWindow: () => focus.window}))
vi.mock('../auto-update', () => ({checkForUpdates: vi.fn()}))
vi.mock('../memory-profiler-window', () => ({isProfilerEnabled: () => false, createProfilerWindow: vi.fn()}))

import {createAppMenu} from '../app-menu'

beforeEach(() => {
  focus.contents = null
  focus.window = null
})

describe('focus-aware refresh menu shortcuts', () => {
  it('uses current focus on each invocation, preserving Seed when an HTML app has focus', () => {
    const shell = {url: 'http://localhost:5173', parent: null, isDestroyed: () => false, reload: vi.fn()}
    const page = {url: `seed-page://${'a'.repeat(40)}/`, parent: shell, isDestroyed: () => false, reload: vi.fn()}
    const nested = {url: 'https://www.youtube.com/embed/test', parent: page, isDestroyed: () => false, reload: vi.fn()}
    const contents = {
      mainFrame: shell,
      focusedFrame: page as any,
      isDestroyed: () => false,
      reload: vi.fn(),
      reloadIgnoringCache: vi.fn(),
    }
    focus.contents = contents
    const menu = createAppMenu()
    const reload = menu.getMenuItemById('reload')!
    const force = menu.getMenuItemById('forceReload')!
    expect(reload.accelerator).toBe('CmdOrCtrl+R')
    expect(force.accelerator).toBe('CmdOrCtrl+Shift+R')
    expect(reload.role).toBeUndefined() // A native role would override our click handler.
    reload.click!(reload, undefined, {} as any)
    expect(page.reload).toHaveBeenCalledTimes(1)
    expect(contents.reload).not.toHaveBeenCalled()

    contents.focusedFrame = nested
    force.click!(force, undefined, {} as any)
    expect(page.reload).toHaveBeenCalledTimes(2)
    expect(nested.reload).not.toHaveBeenCalled()
    expect(contents.reloadIgnoringCache).not.toHaveBeenCalled()

    contents.focusedFrame = shell
    reload.click!(reload, undefined, {} as any)
    force.click!(force, undefined, {} as any)
    expect(contents.reload).toHaveBeenCalledTimes(1)
    expect(contents.reloadIgnoringCache).toHaveBeenCalledTimes(1)
    expect(page.reload).toHaveBeenCalledTimes(2)
  })

  it('falls back to the focused window when native controls own focus, but does nothing without a live window', () => {
    const reload = createAppMenu().getMenuItemById('reload')!
    expect(() => reload.click!(reload, undefined, {} as any)).not.toThrow()
    const contents = {isDestroyed: () => false, focusedFrame: null, reload: vi.fn()}
    focus.window = {webContents: contents}
    reload.click!(reload, undefined, {} as any)
    expect(contents.reload).toHaveBeenCalledOnce()
    contents.isDestroyed = () => true
    reload.click!(reload, undefined, {} as any)
    expect(contents.reload).toHaveBeenCalledOnce()
  })
})

describe('Go to Parent shortcut', () => {
  it('owns Cmd/Ctrl+Up and dispatches go_to_parent to the focused window', async () => {
    const {dispatchFocusedWindowAppEvent} = await import('../app-api')
    const menu = createAppMenu()
    const up = menu.getMenuItemById('go_to_parent')!
    expect(up.accelerator).toBe('CmdOrCtrl+Up')
    up.click!(up, undefined, {} as any)
    expect(dispatchFocusedWindowAppEvent).toHaveBeenCalledWith({type: 'go_to_parent'})
    // Maximize used to hold Cmd+Up; no other item may still claim it.
    const all = menu.items.flatMap((item: any) => item.submenu?.items || [])
    expect(all.filter((item: any) => item.accelerator === 'CmdOrCtrl+Up')).toHaveLength(1)
  })
})
