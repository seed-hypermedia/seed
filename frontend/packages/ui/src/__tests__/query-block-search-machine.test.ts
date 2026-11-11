import type {HMMentionCandidate} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {createActor} from 'xstate'
import {describe, expect, it} from 'vitest'
import {
  getQueryBlockMentionRef,
  queryBlockSearchMachine,
  type QueryBlockSearchEmitted,
} from '../query-block-search-machine'

const bea: HMMentionCandidate = {
  id: hmId('bea', {path: [':profile'], version: 'x'}),
  type: 'account',
  title: 'Bea',
  icon: '',
  parentNames: [],
  searchQuery: '',
  sameSite: false,
  issuedContact: false,
}

const specDoc: HMMentionCandidate = {
  id: hmId('docuid', {path: ['spec', 'one'], version: 'x'}),
  type: 'document',
  title: 'Spec One',
  icon: '',
  parentNames: [],
  searchQuery: '',
  sameSite: false,
  issuedContact: false,
}

function startActor() {
  const applied: string[] = []
  const actor = createActor(queryBlockSearchMachine)
  actor.on('search.applied', (event: QueryBlockSearchEmitted) => applied.push(event.value))
  actor.start()
  actor.send({type: 'search.expanded', search: ''})
  return {actor, applied}
}

function results(actor: ReturnType<typeof createActor<typeof queryBlockSearchMachine>>, over = {}) {
  actor.send({type: 'mention.results', suggestions: [bea], isFetching: false, isError: false, ...over})
}

describe('queryBlockSearchMachine', () => {
  it('emits every typed value while editing plain text', () => {
    const {actor, applied} = startActor()
    actor.send({type: 'input.changed', value: 'n'})
    actor.send({type: 'input.changed', value: 'ne'})
    expect(applied).toEqual(['n', 'ne'])
    expect(actor.getSnapshot().matches({editing: 'text'})).toBe(true)
  })

  it('enters the mention state on a leading trigger and clears the applied search', () => {
    const {actor, applied} = startActor()
    actor.send({type: 'input.changed', value: 'abc'})
    actor.send({type: 'input.changed', value: '@be'})
    expect(applied).toEqual(['abc', ''])
    expect(actor.getSnapshot().matches({editing: 'mention'})).toBe(true)
    expect(actor.getSnapshot().hasTag('menuOpen')).toBe(true)
    expect(actor.getSnapshot().context.draft).toBe('@be')
  })

  it('emits the bare account ref on Enter and collapses', () => {
    const {actor, applied} = startActor()
    actor.send({type: 'input.changed', value: '@be'})
    results(actor)
    actor.send({type: 'key.down'})
    expect(actor.getSnapshot().context.selected).toBe(0) // wrapped
    actor.send({type: 'key.enter'})
    expect(applied).toEqual(['', 'hm://bea'])
    expect(actor.getSnapshot().matches('collapsed')).toBe(true)
  })

  it('emits the document ref with its path and no version on mention.picked', () => {
    const {actor, applied} = startActor()
    actor.send({type: 'input.changed', value: '[[spec'})
    actor.send({type: 'mention.picked', candidate: specDoc})
    expect(applied).toEqual(['', 'hm://docuid/spec/one'])
    expect(actor.getSnapshot().matches('collapsed')).toBe(true)
  })

  it('ignores Enter while fetching and stays in mention', () => {
    const {actor, applied} = startActor()
    actor.send({type: 'input.changed', value: '@be'})
    results(actor, {suggestions: [], isFetching: true})
    actor.send({type: 'key.enter'})
    expect(applied).toEqual([''])
    expect(actor.getSnapshot().matches({editing: 'mention'})).toBe(true)
  })

  it('dismisses on Escape, applies the trigger literally, and returns to text when it stops parsing', () => {
    const {actor, applied} = startActor()
    actor.send({type: 'input.changed', value: '@be'})
    results(actor)
    actor.send({type: 'key.escape'})
    expect(actor.getSnapshot().matches({editing: 'dismissed'})).toBe(true)
    expect(actor.getSnapshot().hasTag('menuOpen')).toBe(false)
    expect(applied).toEqual(['', '@be'])
    actor.send({type: 'input.changed', value: '@bea'})
    expect(actor.getSnapshot().matches({editing: 'dismissed'})).toBe(true)
    expect(applied).toEqual(['', '@be', '@bea'])
    actor.send({type: 'input.changed', value: 'bea'})
    expect(actor.getSnapshot().matches({editing: 'text'})).toBe(true)
    expect(applied).toEqual(['', '@be', '@bea', 'bea'])
  })

  it('applies the draft on blur in mention and nothing on blur in text', () => {
    const {actor, applied} = startActor()
    actor.send({type: 'input.changed', value: '@be'})
    results(actor)
    actor.send({type: 'input.blurred'})
    expect(applied).toEqual(['', '@be'])
    expect(actor.getSnapshot().matches('collapsed')).toBe(true)

    actor.send({type: 'search.expanded', search: ''})
    actor.send({type: 'input.changed', value: 'abc'})
    applied.length = 0
    actor.send({type: 'input.blurred'})
    expect(applied).toEqual([])
    expect(actor.getSnapshot().matches('collapsed')).toBe(true)
  })

  it('reopens the menu for a new trigger after a dismissal and re-expand', () => {
    const {actor} = startActor()
    actor.send({type: 'input.changed', value: '@be'})
    results(actor)
    actor.send({type: 'key.escape'})
    actor.send({type: 'input.blurred'})
    actor.send({type: 'search.expanded', search: '@be'})
    expect(actor.getSnapshot().matches({editing: 'text'})).toBe(true)
    actor.send({type: 'input.changed', value: '@bea'})
    expect(actor.getSnapshot().matches({editing: 'mention'})).toBe(true)
    expect(actor.getSnapshot().hasTag('menuOpen')).toBe(true)
  })

  it('clamps the selection when results shrink', () => {
    const {actor} = startActor()
    actor.send({type: 'input.changed', value: '@'})
    actor.send({
      type: 'mention.results',
      suggestions: [bea, specDoc, bea],
      isFetching: false,
      isError: false,
    })
    actor.send({type: 'key.down'})
    actor.send({type: 'key.down'})
    expect(actor.getSnapshot().context.selected).toBe(2)
    results(actor)
    expect(actor.getSnapshot().context.selected).toBe(0)
  })
})

describe('getQueryBlockMentionRef', () => {
  it('strips everything but the uid for accounts and keeps paths for documents', () => {
    expect(getQueryBlockMentionRef(bea)).toBe('hm://bea')
    expect(getQueryBlockMentionRef(specDoc)).toBe('hm://docuid/spec/one')
  })
})
