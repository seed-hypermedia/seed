import type {InlineMentionsResult} from '@shm/shared/models/inline-mentions'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {createActor, fromCallback} from 'xstate'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {mentionMenuMachine, MentionSearchFn} from './mention-menu-machine'
import {MentionMode} from './mention-suggestion-plugin'

let sendPluginUpdate: (update: {active: boolean; query?: string; mode?: MentionMode}) => void
const machine = mentionMenuMachine.provide({
  actors: {
    pluginListener: fromCallback(({sendBack}) => {
      sendPluginUpdate = ({active, query = '', mode = 'account'}) =>
        sendBack({type: 'plugin.updated', active, query, mode, decorationId: 'dec-1'})
    }),
    scrollListener: fromCallback(() => {}),
  },
})
function item(uid: string, type: MentionMode = 'account'): InlineMentionsResult[number] {
  return {
    id: hmId(uid, {
      path: type === 'document' ? ['doc'] : undefined,
      version: type === 'document' ? 'v1' : undefined,
      latest: type === 'document',
    }),
    title: uid,
    icon: '',
    parentNames: [],
    searchQuery: '',
    type,
    sameSite: false,
    issuedContact: false,
  }
}
function setup(search: MentionSearchFn) {
  const editor = {
    domElement: document.createElement('div'),
    mentionMenu: {onKeyboard: null, insertMention: vi.fn(), close: vi.fn()},
  }
  const actor = createActor(machine, {input: {editor: editor as any, search}}).start()
  return {actor, editor}
}
const flush = () => vi.advanceTimersByTimeAsync(0)
describe('mentionMenuMachine', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('loads initial suggestions immediately in account mode', async () => {
    const search = vi.fn(async () => [item('a')])
    const {actor} = setup(search)
    expect(actor.getSnapshot().matches('closed')).toBe(true)
    sendPluginUpdate({active: true})
    await flush()
    expect(search).toHaveBeenCalledWith('', undefined, {mode: 'account', siteUid: undefined, documentId: undefined})
    expect(actor.getSnapshot().context.suggestions).toHaveLength(1)
    actor.stop()
  })
  it('debounces query updates and refuses stale selection during refresh', async () => {
    const search = vi.fn(async () => [item('a')])
    const {actor, editor} = setup(search)
    sendPluginUpdate({active: true})
    await flush()
    sendPluginUpdate({active: true, query: 'a'})
    actor.send({type: 'menu.key', key: 'Enter'})
    expect(editor.mentionMenu.insertMention).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    sendPluginUpdate({active: true, query: 'ab'})
    await vi.advanceTimersByTimeAsync(149)
    expect(search).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(search).toHaveBeenCalledTimes(2)
    actor.stop()
  })
  it('uses explicit profile and latest-document links with mentionKind', async () => {
    const {actor, editor} = setup(async (_q, _uid, options) => [item('a', options!.mode)])
    sendPluginUpdate({active: true})
    await flush()
    actor.send({type: 'menu.key', key: 'Enter'})
    expect(editor.mentionMenu.insertMention).toHaveBeenCalledWith('hm://a/:profile', 'account')
    sendPluginUpdate({active: true, mode: 'document'})
    await vi.advanceTimersByTimeAsync(150)
    actor.send({type: 'menu.key', key: 'Enter'})
    expect(editor.mentionMenu.insertMention).toHaveBeenLastCalledWith(expect.stringContaining('v=v1'), 'document')
    actor.stop()
  })
  it('keeps long empty searches open and supports retry after failure', async () => {
    const search = vi.fn<MentionSearchFn>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
    const {actor} = setup(search)
    sendPluginUpdate({active: true, query: 'nothinghere'})
    await flush()
    expect(actor.getSnapshot().context.error).toBe(true)
    actor.send({type: 'menu.retry'})
    expect(actor.getSnapshot().matches({open: 'searching'})).toBe(true)
    expect(actor.getSnapshot().context.error).toBe(false)
    await flush()
    expect(actor.getSnapshot().matches({open: 'loaded'})).toBe(true)
    expect(actor.getSnapshot().context.error).toBe(false)
    actor.stop()
  })
  it('wraps flat navigation and preserves the highlighted identity after refresh', async () => {
    const {actor} = setup(async (q) => (q ? [item('b'), item('a')] : [item('a'), item('b')]))
    sendPluginUpdate({active: true})
    await flush()
    actor.send({type: 'menu.key', key: 'ArrowUp'})
    expect(actor.getSnapshot().context.selected).toBe(1)
    sendPluginUpdate({active: true, query: 'b'})
    await vi.advanceTimersByTimeAsync(150)
    expect(actor.getSnapshot().context.selected).toBe(0)
    actor.stop()
  })
  it('ignores a late response after the mode changes', async () => {
    let resolve!: (value: InlineMentionsResult) => void
    const {actor} = setup((_q, _uid, options) =>
      options!.mode === 'account'
        ? new Promise((r) => {
            resolve = r
          })
        : Promise.resolve([item('doc', 'document')]),
    )
    sendPluginUpdate({active: true})
    sendPluginUpdate({active: true, mode: 'document'})
    await vi.advanceTimersByTimeAsync(150)
    resolve([item('old')])
    await flush()
    expect(actor.getSnapshot().context.suggestions[0]?.type).toBe('document')
    actor.stop()
  })
  it('does not insert stale results after a failed refresh', async () => {
    const search = vi
      .fn<MentionSearchFn>()
      .mockResolvedValueOnce([item('a')])
      .mockRejectedValueOnce(new Error('offline'))
    const {actor, editor} = setup(search)
    sendPluginUpdate({active: true})
    await flush()
    sendPluginUpdate({active: true, query: 'different'})
    await vi.advanceTimersByTimeAsync(150)
    actor.send({type: 'menu.key', key: 'Enter'})
    actor.send({type: 'menu.select', item: item('a')})
    expect(editor.mentionMenu.insertMention).not.toHaveBeenCalled()
    actor.stop()
  })
  it('passes identity and site context and refreshes on changes', async () => {
    const search = vi.fn(async () => [])
    const {actor} = setup(search)
    sendPluginUpdate({active: true})
    await flush()
    actor.send({type: 'options.updated', search, perspectiveAccountUid: 'writer', siteUid: 'site'})
    await vi.advanceTimersByTimeAsync(150)
    expect(search).toHaveBeenLastCalledWith('', 'writer', {mode: 'account', siteUid: 'site', documentId: undefined})
    actor.stop()
  })
})
