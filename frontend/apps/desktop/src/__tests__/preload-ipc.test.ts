import {EventEmitter} from 'node:events'
import type {IpcRenderer} from 'electron'
import {afterEach, expect, it, vi} from 'vitest'
import {createRendererIPC} from '../preload-ipc'

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
