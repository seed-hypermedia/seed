import type {IpcRenderer} from 'electron'
import {EventEmitter} from 'node:events'
import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {afterEach, expect, it, vi} from 'vitest'
import {createRendererIPC, SEND_COMMANDS} from '../preload-ipc'

afterEach(() => vi.restoreAllMocks())

it('preserves allowed sends, listener payloads and unsubscribe', async () => {
  const transport = Object.assign(new EventEmitter(), {send: vi.fn()})
  const bridge = createRendererIPC(transport as unknown as IpcRenderer)
  const payload = {routeIndex: 1}
  bridge.send('windowNavState', payload)
  expect(transport.send).toHaveBeenCalledWith('windowNavState', payload)
  const handler = vi.fn()
  const stop = await bridge.listen('open_route', handler)
  const info = {}
  transport.emit('open_route', info, payload)
  expect(handler).toHaveBeenCalledWith({info, payload})
  stop()
  transport.emit('open_route', info, payload)
  expect(handler).toHaveBeenCalledTimes(1)
})

it('rejects unknown channels before touching the transport and warns', async () => {
  const transport = Object.assign(new EventEmitter(), {send: vi.fn()})
  const bridge = createRendererIPC(transport as unknown as IpcRenderer)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  for (const cmd of ['initWindow', 'open-markdown-file', '__proto__', 'arbitrary-command']) {
    bridge.send(cmd, 'payload')
    const stop = await bridge.listen(cmd, vi.fn())
    stop()
    expect(transport.listenerCount(cmd)).toBe(0)
  }
  expect(transport.send).not.toHaveBeenCalled()
  expect(warn).toHaveBeenCalledTimes(8)
})

it('restricts the find overlay to its two send commands', () => {
  const transport = Object.assign(new EventEmitter(), {send: vi.fn()})
  const bridge = createRendererIPC(transport as unknown as IpcRenderer, true)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  bridge.send('find_in_page_query', {query: 'hello'})
  bridge.send('find_in_page_cancel')
  bridge.send('quit_app')
  expect(transport.send).toHaveBeenCalledTimes(2)
})

/** Channel names used as string literals by `pattern` across the desktop sources, excluding tests. */
function channelsIn(pattern: RegExp, keep: (file: string) => boolean): Set<string> {
  const root = join(__dirname, '..')
  const found = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const file = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(file)
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && keep(file)) {
        for (const match of Array.from(readFileSync(file, 'utf8').matchAll(pattern))) found.add(match[1]!)
      }
    }
  }
  walk(root)
  return found
}

it('allows every channel the renderer sends, and only channels the main process handles', () => {
  const sent = channelsIn(/\bipc\.send\??\.?\(\s*['"]([^'"]+)['"]/g, (file) => !file.includes('preload'))
  const handled = channelsIn(/\b(?:ipcMain\.on|ipc\.on|ipc\.addListener)\(\s*['"]([^'"]+)['"]/g, () => true)
  expect(sent.size).toBeGreaterThan(10)
  expect(Array.from(sent).filter((cmd) => !SEND_COMMANDS.has(cmd))).toEqual([])
  expect(Array.from(SEND_COMMANDS).filter((cmd) => !handled.has(cmd))).toEqual([])
  const transport = Object.assign(new EventEmitter(), {send: vi.fn()})
  const bridge = createRendererIPC(transport as unknown as IpcRenderer)
  sent.forEach((cmd) => bridge.send(cmd, {}))
  expect(transport.send).toHaveBeenCalledTimes(sent.size)
})
