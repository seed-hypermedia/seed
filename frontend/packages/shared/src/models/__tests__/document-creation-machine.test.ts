import {hmId} from '../../utils/entity-id-url'
import {describe, expect, it} from 'vitest'
import {createActor, waitFor} from 'xstate'
import {
  documentCreationMachine,
  type DocumentCreationInput,
  type DocumentCreationResolutionInput,
} from '../document-creation-machine'

const currentId = hmId('alice', {path: ['projects', 'one']})
const parentId = hmId('alice', {path: ['projects']})
const schema = {attributes: [{key: 'status', type: 'text' as const}]}

function start(
  resolution: DocumentCreationResolutionInput,
  create: DocumentCreationInput['create'] = async () => hmId('alice', {path: ['new']}),
) {
  return createActor(documentCreationMachine, {
    input: {
      currentId,
      resolve: async () => resolution,
      create,
    },
  }).start()
}

describe('documentCreationMachine', () => {
  it('creates a schema-shaped sibling for an editable collection child', async () => {
    const calls: any[] = []
    const actor = start(
      {
        canEditCurrent: true,
        currentIsCollection: false,
        parentId,
        parentIsCollection: true,
        canEditParent: true,
        schema,
      },
      async (request) => {
        calls.push(request)
        return hmId('alice', {path: ['projects', 'new']})
      },
    )
    await waitFor(actor, (state) => state.matches({resolved: 'ready'}))
    expect(actor.getSnapshot().can({type: 'create.requested', kind: 'subdocument'})).toBe(true)
    actor.send({type: 'create.requested', kind: 'document'})
    await waitFor(actor, (state) => state.status === 'done')
    expect(calls).toEqual([{kind: 'document', destination: parentId, metadata: {status: ''}}])
  })

  it('falls back to a normal child when the collection parent is not editable', async () => {
    const calls: any[] = []
    const actor = start(
      {
        canEditCurrent: true,
        currentIsCollection: false,
        parentId,
        parentIsCollection: true,
        canEditParent: false,
        schema,
      },
      async (request) => {
        calls.push(request)
        return currentId
      },
    )
    await waitFor(actor, (state) => state.matches({resolved: 'ready'}))
    expect(actor.getSnapshot().can({type: 'create.requested', kind: 'subdocument'})).toBe(false)
    actor.send({type: 'create.requested', kind: 'document'})
    await waitFor(actor, (state) => state.status === 'done')
    expect(calls).toEqual([{kind: 'document', destination: currentId, metadata: {}}])
  })

  it('hides creation from non-editors', async () => {
    const actor = start({canEditCurrent: false, currentIsCollection: false})
    await waitFor(actor, (state) => state.matches({resolved: 'hidden'}))
    expect(actor.getSnapshot().can({type: 'create.requested', kind: 'document'})).toBe(false)
  })

  it('finishes with the resolved import handoff', async () => {
    const actor = start({
      canEditCurrent: true,
      currentIsCollection: true,
      schema,
      capabilityCid: 'cap',
    })
    await waitFor(actor, (state) => state.matches({resolved: 'ready'}))
    actor.send({type: 'import.requested'})
    await waitFor(actor, (state) => state.status === 'done')
    expect(actor.getSnapshot().output).toEqual({
      type: 'import',
      destination: currentId,
      capabilityCid: 'cap',
      schema,
    })
  })
})
