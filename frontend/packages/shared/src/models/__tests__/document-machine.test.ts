import {describe, expect, it} from 'vitest'
import {createActor, fromPromise} from 'xstate'
import {documentMachine, DocumentMachineInput} from '../document-machine'
import {HMDocument} from '@seed-hypermedia/client/hm-types'

const mockDocumentId = {
  id: 'hm://z6Mktest/doc',
  uid: 'z6Mktest',
  path: ['doc'],
  version: null,
  blockRef: null,
  blockRange: null,
  hostname: null,
  scheme: 'hm',
} as DocumentMachineInput['documentId']

const mockDocument = {
  content: [],
  version: 'bafyabc.bafydef',
  account: 'z6Mktest',
  authors: ['z6Mktest'],
  path: '/doc',
  createTime: '2025-01-01T00:00:00Z',
  updateTime: '2025-01-01T00:00:00Z',
  metadata: {name: 'Test Doc'},
  genesis: 'bafygenesis',
  visibility: 'PUBLIC',
} as unknown as HMDocument

/** Create an actor with test-friendly provided actors. */
function createTestActor(inputOverrides: Partial<DocumentMachineInput> = {}) {
  const machine = documentMachine.provide({
    actors: {
      writeDraft: fromPromise<{id: string}, any>(async () => ({id: 'draft-123'})),
      publishDocument: fromPromise<HMDocument, any>(async () => ({
        ...mockDocument,
        version: 'bafynew',
      })),
    },
  })

  return createActor(machine, {
    input: {
      documentId: mockDocumentId,
      canEdit: true,
      ...inputOverrides,
    },
  })
}

describe('DocumentLifecycle machine', () => {
  it('starts in loading state', () => {
    const actor = createTestActor()
    actor.start()
    expect(actor.getSnapshot().value).toBe('loading')
    actor.stop()
  })

  it('loading → document.loaded → loaded', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    expect(actor.getSnapshot().value).toBe('loaded')
    expect(actor.getSnapshot().context.publishedVersion).toBe('bafyabc.bafydef')
    expect(actor.getSnapshot().context.document).toBe(mockDocument)
    actor.stop()
  })

  it('loading → document.error → stays in loading (stores error)', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({type: 'document.error', error: 'network failure'})
    expect(actor.getSnapshot().value).toBe('loading')
    expect(actor.getSnapshot().context.error).toBe('network failure')
    actor.stop()
  })

  it('loading → document.error → document.loaded → loaded (retry succeeds)', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({type: 'document.error', error: 'fail'})
    expect(actor.getSnapshot().value).toBe('loading')
    actor.send({type: 'document.loaded', document: mockDocument})
    expect(actor.getSnapshot().value).toBe('loaded')
    expect(actor.getSnapshot().context.error).toBe('fail')
    actor.stop()
  })

  it('loading → 10s timeout → error (no document loaded)', async () => {
    const machine = documentMachine.provide({
      actors: {
        writeDraft: fromPromise<{id: string}, any>(async () => ({id: 'draft-123'})),
        publishDocument: fromPromise<HMDocument, any>(async () => mockDocument),
      },
      delays: {
        loadingTimeout: 50, // Short timeout for test
      },
    })
    const actor = createActor(machine, {
      input: {documentId: mockDocumentId, canEdit: true},
    })
    actor.start()
    await new Promise((r) => setTimeout(r, 100))
    expect(actor.getSnapshot().value).toBe('error')
    actor.stop()
  })

  it('error → document.retry → loading (clears error)', async () => {
    const machine = documentMachine.provide({
      actors: {
        writeDraft: fromPromise<{id: string}, any>(async () => ({id: 'draft-123'})),
        publishDocument: fromPromise<HMDocument, any>(async () => mockDocument),
      },
      delays: {
        loadingTimeout: 50,
      },
    })
    const actor = createActor(machine, {
      input: {documentId: mockDocumentId, canEdit: true},
    })
    actor.start()
    await new Promise((r) => setTimeout(r, 100))
    expect(actor.getSnapshot().value).toBe('error')
    actor.send({type: 'document.retry'})
    expect(actor.getSnapshot().value).toBe('loading')
    expect(actor.getSnapshot().context.error).toBeNull()
    // Can now succeed
    actor.send({type: 'document.loaded', document: mockDocument})
    expect(actor.getSnapshot().value).toBe('loaded')
    actor.stop()
  })

  it('loading → document.loaded before timeout → no error', async () => {
    const machine = documentMachine.provide({
      actors: {
        writeDraft: fromPromise<{id: string}, any>(async () => ({id: 'draft-123'})),
        publishDocument: fromPromise<HMDocument, any>(async () => mockDocument),
      },
      delays: {
        loadingTimeout: 200,
      },
    })
    const actor = createActor(machine, {
      input: {documentId: mockDocumentId, canEdit: true},
    })
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    await new Promise((r) => setTimeout(r, 300))
    expect(actor.getSnapshot().value).toBe('loaded')
    actor.stop()
  })

  it('loaded → edit.start (canEdit=true) → editing.idle', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'edit.start'})
    expect(actor.getSnapshot().value).toEqual({editing: 'idle'})
    // deps should be set from publishedVersion
    expect(actor.getSnapshot().context.deps).toEqual(['bafyabc.bafydef'])
    actor.stop()
  })

  it('loaded → edit.start (canEdit=false) → stays loaded', () => {
    const actor = createTestActor({canEdit: false})
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'edit.start'})
    expect(actor.getSnapshot().value).toBe('loaded')
    actor.stop()
  })

  it('editing.idle → change → editing.changed', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'edit.start'})
    actor.send({type: 'change'})
    expect(actor.getSnapshot().value).toEqual({editing: 'changed'})
    actor.stop()
  })

  it('editing.changed → autosave timeout → editing.creating (no draftId)', async () => {
    const actor = createTestActor()
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'edit.start'})
    actor.send({type: 'change'})

    // Wait for autosave timeout (500ms) + buffer
    await new Promise((r) => setTimeout(r, 600))
    expect(actor.getSnapshot().value).toEqual({editing: 'idle'})
    // After creating completes, it goes to idle with draftId set
    expect(actor.getSnapshot().context.draftId).toBe('draft-123')
    expect(actor.getSnapshot().context.draftCreated).toBe(true)
    actor.stop()
  })

  it('editing.changed → autosave timeout → editing.saving (has draftId)', async () => {
    const actor = createTestActor({existingDraftId: 'existing-draft'})
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    // existingDraft triggers auto-transition to editing
    actor.send({type: 'change'})

    await new Promise((r) => setTimeout(r, 600))
    // After saving completes, goes to idle
    expect(actor.getSnapshot().value).toEqual({editing: 'idle'})
    actor.stop()
  })

  it('editing → edit.cancel → loaded', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'edit.start'})
    actor.send({type: 'edit.cancel'})
    expect(actor.getSnapshot().value).toBe('loaded')
    expect(actor.getSnapshot().context.draftCreated).toBe(false)
    actor.stop()
  })

  it('editing.idle → publish.start (has draftId) → publishing.inProgress', () => {
    const actor = createTestActor({existingDraftId: 'my-draft'})
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    // auto-transitions to editing because of existingDraftId
    actor.send({type: 'publish.start'})
    expect(actor.getSnapshot().value).toEqual({publishing: 'inProgress'})
    actor.stop()
  })

  it('publishing.inProgress → done → cleaningUp → loaded', async () => {
    const actor = createTestActor({existingDraftId: 'my-draft'})
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'publish.start'})

    await new Promise((r) => setTimeout(r, 50))
    expect(actor.getSnapshot().value).toBe('loaded')
    expect(actor.getSnapshot().context.draftId).toBeNull()
    expect(actor.getSnapshot().context.draftCreated).toBe(false)
    actor.stop()
  })

  it('document.remoteUpdate in loaded → updates publishedVersion', () => {
    const updatedDoc = {...mockDocument, version: 'bafynewer'}
    const actor = createTestActor()
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'document.remoteUpdate', document: updatedDoc})
    expect(actor.getSnapshot().value).toBe('loaded')
    expect(actor.getSnapshot().context.publishedVersion).toBe('bafynewer')
    actor.stop()
  })

  it('document.remoteUpdate in editing → updates pendingRemoteVersion only', () => {
    const updatedDoc = {...mockDocument, version: 'bafynewer'}
    const actor = createTestActor()
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'edit.start'})
    actor.send({type: 'document.remoteUpdate', document: updatedDoc})
    expect(actor.getSnapshot().value).toEqual({editing: 'idle'})
    expect(actor.getSnapshot().context.pendingRemoteVersion).toBe('bafynewer')
    // publishedVersion stays the same
    expect(actor.getSnapshot().context.publishedVersion).toBe('bafyabc.bafydef')
    actor.stop()
  })

  it('loaded with existingDraftId auto-transitions to editing', () => {
    const actor = createTestActor({existingDraftId: 'existing-draft'})
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    expect(actor.getSnapshot().value).toEqual({editing: 'idle'})
    actor.stop()
  })

  it('publish.start without draftId stays in editing.idle', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'edit.start'})
    actor.send({type: 'publish.start'})
    // No draftId, guard blocks transition
    expect(actor.getSnapshot().value).toEqual({editing: 'idle'})
    actor.stop()
  })

  it('change with metadata updates context.metadata', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'edit.start'})
    actor.send({type: 'change', metadata: {name: 'New Title'}})
    expect(actor.getSnapshot().context.metadata).toEqual({name: 'New Title'})
    actor.stop()
  })
})
