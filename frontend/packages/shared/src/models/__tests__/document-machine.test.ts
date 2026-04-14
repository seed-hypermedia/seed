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
    delays: {
      saveIndicatorDismiss: 50, // Fast dismiss for tests
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

/** Helper: send both events to transition loading → loaded (no draft). */
function loadDocument(actor: ReturnType<typeof createTestActor>, doc = mockDocument) {
  actor.send({type: 'document.loaded', document: doc})
  actor.send({type: 'draft.resolved', draftId: null, content: null, cursorPosition: null})
}

describe('DocumentLifecycle machine', () => {
  it('starts in loading state', () => {
    const actor = createTestActor()
    actor.start()
    expect(actor.getSnapshot().value).toBe('loading')
    actor.stop()
  })

  it('loading → document.loaded alone → stays in loading (waits for draft.resolved)', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    expect(actor.getSnapshot().value).toBe('loading')
    expect(actor.getSnapshot().context.documentReady).toBe(true)
    expect(actor.getSnapshot().context.draftReady).toBe(false)
    expect(actor.getSnapshot().context.document).toBe(mockDocument)
    actor.stop()
  })

  it('loading → document.loaded + draft.resolved → loaded', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'draft.resolved', draftId: null, content: null, cursorPosition: null})
    expect(actor.getSnapshot().value).toBe('loaded')
    expect(actor.getSnapshot().context.publishedVersion).toBe('bafyabc.bafydef')
    expect(actor.getSnapshot().context.document).toBe(mockDocument)
    actor.stop()
  })

  it('loading → draft.resolved first, then document.loaded → loaded', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({type: 'draft.resolved', draftId: null, content: null, cursorPosition: null})
    expect(actor.getSnapshot().value).toBe('loading')
    expect(actor.getSnapshot().context.draftReady).toBe(true)
    actor.send({type: 'document.loaded', document: mockDocument})
    expect(actor.getSnapshot().value).toBe('loaded')
    actor.stop()
  })

  it('loading → draft.resolved with draftId + document.loaded → loaded → auto-editing', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({
      type: 'draft.resolved',
      draftId: 'my-draft',
      content: [{block: {id: 'b1', type: 'Paragraph', text: 'draft text', attributes: {}}, children: []}],
      cursorPosition: null,
    })
    actor.send({type: 'document.loaded', document: mockDocument})
    // Should auto-transition to editing via shouldAutoEdit
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    expect(actor.getSnapshot().context.draftId).toBe('my-draft')
    expect(actor.getSnapshot().context.shouldAutoEdit).toBe(false) // cleared
    expect(actor.getSnapshot().context.draftContent).toEqual([
      {block: {id: 'b1', type: 'Paragraph', text: 'draft text', attributes: {}}, children: []},
    ])
    actor.stop()
  })

  it('draftContent is cleared on publish', async () => {
    const actor = createTestActor({existingDraftId: 'my-draft'})
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'publish.start'})
    await new Promise((r) => setTimeout(r, 50))
    expect(actor.getSnapshot().value).toBe('loaded')
    expect(actor.getSnapshot().context.draftContent).toBeNull()
    actor.stop()
  })

  it('draftContent is cleared on discard', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({
      type: 'draft.resolved',
      draftId: 'my-draft',
      content: [{block: {id: 'b1', type: 'Paragraph', text: 'draft', attributes: {}}, children: []}],
      cursorPosition: null,
    })
    actor.send({type: 'document.loaded', document: mockDocument})
    expect(actor.getSnapshot().context.draftContent).not.toBeNull()
    actor.send({type: 'edit.discard'})
    expect(actor.getSnapshot().context.draftContent).toBeNull()
    actor.stop()
  })

  it('draftCursorPosition is stored on draft.resolved and cleared on discard', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({
      type: 'draft.resolved',
      draftId: 'my-draft',
      content: [{block: {id: 'b1', type: 'Paragraph', text: 'draft', attributes: {}}, children: []}],
      cursorPosition: 42,
    })
    actor.send({type: 'document.loaded', document: mockDocument})
    expect(actor.getSnapshot().context.draftCursorPosition).toBe(42)
    actor.send({type: 'edit.discard'})
    expect(actor.getSnapshot().context.draftCursorPosition).toBeNull()
    actor.stop()
  })

  it('draftContent is preserved on edit.cancel', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({
      type: 'draft.resolved',
      draftId: 'my-draft',
      content: [{block: {id: 'b1', type: 'Paragraph', text: 'draft', attributes: {}}, children: []}],
      cursorPosition: null,
    })
    actor.send({type: 'document.loaded', document: mockDocument})
    expect(actor.getSnapshot().context.draftContent).not.toBeNull()
    actor.send({type: 'edit.cancel'})
    expect(actor.getSnapshot().value).toBe('loaded')
    // draftContent preserved so re-entering editing still has it
    expect(actor.getSnapshot().context.draftContent).not.toBeNull()
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

  it('loading → document.error → document.loaded + draft.resolved → loaded (retry succeeds)', () => {
    const actor = createTestActor()
    actor.start()
    actor.send({type: 'document.error', error: 'fail'})
    expect(actor.getSnapshot().value).toBe('loading')
    loadDocument(actor)
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
    loadDocument(actor)
    expect(actor.getSnapshot().value).toBe('loaded')
    actor.stop()
  })

  it('loading → both sources before timeout → no error', async () => {
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
    actor.send({type: 'draft.resolved', draftId: null, content: null, cursorPosition: null})
    await new Promise((r) => setTimeout(r, 300))
    expect(actor.getSnapshot().value).toBe('loaded')
    actor.stop()
  })

  it('loaded → edit.start (canEdit=true) → editing.idle', () => {
    const actor = createTestActor()
    actor.start()
    loadDocument(actor)
    actor.send({type: 'edit.start'})
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    // deps should be set from publishedVersion
    expect(actor.getSnapshot().context.deps).toEqual(['bafyabc.bafydef'])
    actor.stop()
  })

  it('loaded → edit.start (canEdit=false) → stays loaded', () => {
    const actor = createTestActor({canEdit: false})
    actor.start()
    loadDocument(actor)
    actor.send({type: 'edit.start'})
    expect(actor.getSnapshot().value).toBe('loaded')
    actor.stop()
  })

  it('editing.idle → change → editing.changed', () => {
    const actor = createTestActor()
    actor.start()
    loadDocument(actor)
    actor.send({type: 'edit.start'})
    actor.send({type: 'change'})
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'changed', saveIndicator: 'hidden'}})
    actor.stop()
  })

  it('editing.changed → autosave timeout → editing.creating (no draftId)', async () => {
    const actor = createTestActor()
    actor.start()
    loadDocument(actor)
    actor.send({type: 'edit.start'})
    actor.send({type: 'change'})

    // Wait for autosave timeout (500ms) + buffer
    await new Promise((r) => setTimeout(r, 600))
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
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
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    actor.stop()
  })

  it('editing → edit.cancel → loaded', () => {
    const actor = createTestActor()
    actor.start()
    loadDocument(actor)
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
    loadDocument(actor)
    actor.send({type: 'document.remoteUpdate', document: updatedDoc})
    expect(actor.getSnapshot().value).toBe('loaded')
    expect(actor.getSnapshot().context.publishedVersion).toBe('bafynewer')
    actor.stop()
  })

  it('document.remoteUpdate in editing → updates pendingRemoteVersion only', () => {
    const updatedDoc = {...mockDocument, version: 'bafynewer'}
    const actor = createTestActor()
    actor.start()
    loadDocument(actor)
    actor.send({type: 'edit.start'})
    actor.send({type: 'document.remoteUpdate', document: updatedDoc})
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    expect(actor.getSnapshot().context.pendingRemoteVersion).toBe('bafynewer')
    // publishedVersion stays the same
    expect(actor.getSnapshot().context.publishedVersion).toBe('bafyabc.bafydef')
    actor.stop()
  })

  it('loaded with existingDraftId auto-transitions to editing', () => {
    const actor = createTestActor({existingDraftId: 'existing-draft'})
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    actor.stop()
  })

  it('publish.start without draftId stays in editing.idle', () => {
    const actor = createTestActor()
    actor.start()
    loadDocument(actor)
    actor.send({type: 'edit.start'})
    actor.send({type: 'publish.start'})
    // No draftId, guard blocks transition
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    actor.stop()
  })

  it('change with metadata updates context.metadata', () => {
    const actor = createTestActor()
    actor.start()
    loadDocument(actor)
    actor.send({type: 'edit.start'})
    actor.send({type: 'change', metadata: {name: 'New Title'}})
    expect(actor.getSnapshot().context.metadata).toEqual({name: 'New Title'})
    actor.stop()
  })

  // -- capability.changed tests --

  it('capability.changed in loaded → updates canEdit', () => {
    const actor = createTestActor({canEdit: true})
    actor.start()
    loadDocument(actor)
    expect(actor.getSnapshot().context.canEdit).toBe(true)
    actor.send({type: 'capability.changed', canEdit: false})
    expect(actor.getSnapshot().context.canEdit).toBe(false)
    expect(actor.getSnapshot().value).toBe('loaded')
    actor.stop()
  })

  it('capability.changed in editing (lost) → exits to loaded', () => {
    const actor = createTestActor({canEdit: true})
    actor.start()
    loadDocument(actor)
    actor.send({type: 'edit.start'})
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    actor.send({type: 'capability.changed', canEdit: false})
    expect(actor.getSnapshot().value).toBe('loaded')
    expect(actor.getSnapshot().context.canEdit).toBe(false)
    actor.stop()
  })

  it('capability.changed in editing (still can edit) → stays in editing', () => {
    const actor = createTestActor({canEdit: true})
    actor.start()
    loadDocument(actor)
    actor.send({type: 'edit.start'})
    actor.send({type: 'capability.changed', canEdit: true})
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    actor.stop()
  })

  it('capability.changed in loading → updates canEdit', () => {
    const actor = createTestActor({canEdit: false})
    actor.start()
    expect(actor.getSnapshot().value).toBe('loading')
    actor.send({type: 'capability.changed', canEdit: true})
    expect(actor.getSnapshot().context.canEdit).toBe(true)
    actor.stop()
  })

  it('capability.changed to true + existing draft → auto-edit after loaded', () => {
    // existingDraftId sets draftReady: true, so only document.loaded is needed
    const actor = createTestActor({canEdit: false, existingDraftId: 'draft-1'})
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    // shouldAutoEdit is true (from existingDraftId), draftReady is true,
    // documentReady is now true → transitions to loaded → always to editing
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    actor.stop()
  })

  it('edit.discard → loaded (clears draftId)', () => {
    const actor = createTestActor({existingDraftId: 'draft-to-discard'})
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    // auto-transitions to editing because of existingDraftId
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    actor.send({type: 'edit.discard'})
    expect(actor.getSnapshot().value).toBe('loaded')
    expect(actor.getSnapshot().context.draftId).toBeNull()
    expect(actor.getSnapshot().context.draftCreated).toBe(false)
    actor.stop()
  })

  // -- draft.existing event tests (async draft discovery on reload) --

  it('draft.existing in loading → stores draftId, then document.loaded auto-transitions to editing', () => {
    const actor = createTestActor()
    actor.start()
    expect(actor.getSnapshot().value).toBe('loading')
    // Draft discovered while still loading
    actor.send({type: 'draft.existing', draftId: 'late-draft'})
    expect(actor.getSnapshot().context.draftId).toBe('late-draft')
    expect(actor.getSnapshot().context.shouldAutoEdit).toBe(true)
    expect(actor.getSnapshot().value).toBe('loading') // still loading
    // Document arrives
    actor.send({type: 'document.loaded', document: mockDocument})
    // Should auto-transition to editing via the always guard
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    expect(actor.getSnapshot().context.shouldAutoEdit).toBe(false) // cleared
    actor.stop()
  })

  it('draft.existing in loaded → transitions directly to editing', () => {
    const actor = createTestActor()
    actor.start()
    loadDocument(actor)
    expect(actor.getSnapshot().value).toBe('loaded')
    // Draft discovered after document loaded
    actor.send({type: 'draft.existing', draftId: 'late-draft'})
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    expect(actor.getSnapshot().context.draftId).toBe('late-draft')
    expect(actor.getSnapshot().context.draftCreated).toBe(true)
    actor.stop()
  })

  // -- saveIndicator parallel state tests --

  it('saveIndicator: hidden → saving → saved → hidden lifecycle', async () => {
    // Use a slow writeDraft so we can observe the 'saving' indicator state
    const machine = documentMachine.provide({
      actors: {
        writeDraft: fromPromise<{id: string}, any>(async () => {
          await new Promise((r) => setTimeout(r, 100))
          return {id: 'draft-456'}
        }),
        publishDocument: fromPromise<HMDocument, any>(async () => mockDocument),
      },
      delays: {
        autosaveTimeout: 50,
        saveIndicatorDismiss: 100,
      },
    })
    const actor = createActor(machine, {
      input: {documentId: mockDocumentId, canEdit: true},
    })
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'draft.resolved', draftId: null, content: null, cursorPosition: null})
    actor.send({type: 'edit.start'})
    actor.send({type: 'change'})

    // Initially: changed, indicator hidden
    expect(actor.getSnapshot().matches({editing: {saveIndicator: 'hidden'}})).toBe(true)

    // After autosave triggers (50ms) → creating entry raises _save.started → indicator: saving
    // Actor is still running (takes 100ms), so indicator stays in saving
    await new Promise((r) => setTimeout(r, 70))
    expect(actor.getSnapshot().matches({editing: {saveIndicator: 'saving'}})).toBe(true)

    // After actor resolves (~100ms from start) → _save.completed → indicator: saved
    await new Promise((r) => setTimeout(r, 100))
    expect(actor.getSnapshot().matches({editing: {saveIndicator: 'saved'}})).toBe(true)

    // After saveIndicatorDismiss (100ms) → indicator: hidden
    await new Promise((r) => setTimeout(r, 150))
    expect(actor.getSnapshot().matches({editing: {saveIndicator: 'hidden'}})).toBe(true)
    actor.stop()
  })

  // -- account.changed tests --

  it('account.changed updates context in any state', () => {
    const actor = createTestActor()
    actor.start()
    expect(actor.getSnapshot().context.signingAccountId).toBeNull()
    actor.send({type: 'account.changed', signingAccountId: 'acc-1', publishAccountUid: 'uid-1'})
    expect(actor.getSnapshot().context.signingAccountId).toBe('acc-1')
    expect(actor.getSnapshot().context.publishAccountUid).toBe('uid-1')
    actor.stop()
  })

  // -- old version edit guard tests --

  it('edit.start on latest version → straight to editing (no confirmation)', () => {
    const actor = createTestActor({isLatest: true})
    actor.start()
    loadDocument(actor)
    expect(actor.getSnapshot().context.isLatestVersion).toBe(true)
    actor.send({type: 'edit.start'})
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    actor.stop()
  })

  it('edit.start on old version → confirmingOldVersionEdit', () => {
    const actor = createTestActor({isLatest: false})
    actor.start()
    loadDocument(actor)
    expect(actor.getSnapshot().context.isLatestVersion).toBe(false)
    actor.send({type: 'edit.start'})
    expect(actor.getSnapshot().value).toBe('confirmingOldVersionEdit')
    actor.stop()
  })

  it('confirmingOldVersionEdit → edit.confirm → editing with deps set', () => {
    const actor = createTestActor({isLatest: false})
    actor.start()
    loadDocument(actor)
    actor.send({type: 'edit.start'})
    expect(actor.getSnapshot().value).toBe('confirmingOldVersionEdit')
    actor.send({type: 'edit.confirm'})
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    expect(actor.getSnapshot().context.deps).toEqual(['bafyabc.bafydef'])
    actor.stop()
  })

  it('confirmingOldVersionEdit → edit.cancel → back to loaded', () => {
    const actor = createTestActor({isLatest: false})
    actor.start()
    loadDocument(actor)
    actor.send({type: 'edit.start'})
    expect(actor.getSnapshot().value).toBe('confirmingOldVersionEdit')
    actor.send({type: 'edit.cancel'})
    expect(actor.getSnapshot().value).toBe('loaded')
    actor.stop()
  })

  it('edit.start on old version with canEdit=false → stays loaded', () => {
    const actor = createTestActor({canEdit: false, isLatest: false})
    actor.start()
    loadDocument(actor)
    actor.send({type: 'edit.start'})
    expect(actor.getSnapshot().value).toBe('loaded')
    actor.stop()
  })

  it('version.changed updates isLatestVersion in loaded state', () => {
    const actor = createTestActor({isLatest: true})
    actor.start()
    loadDocument(actor)
    expect(actor.getSnapshot().context.isLatestVersion).toBe(true)
    actor.send({type: 'version.changed', isLatest: false})
    expect(actor.getSnapshot().context.isLatestVersion).toBe(false)
    actor.stop()
  })

  it('version.changed updates isLatestVersion in editing state', () => {
    const actor = createTestActor({isLatest: true})
    actor.start()
    loadDocument(actor)
    actor.send({type: 'edit.start'})
    actor.send({type: 'version.changed', isLatest: false})
    expect(actor.getSnapshot().context.isLatestVersion).toBe(false)
    actor.stop()
  })

  it('auto-edit with draft on old version → stays loaded (no auto-edit)', () => {
    const actor = createTestActor({isLatest: false})
    actor.start()
    actor.send({
      type: 'draft.resolved',
      draftId: 'my-draft',
      content: [{block: {id: 'b1', type: 'Paragraph', text: 'draft text', attributes: {}}, children: []}],
      cursorPosition: null,
    })
    actor.send({type: 'document.loaded', document: mockDocument})
    // Should NOT auto-transition to editing because isLatestVersion is false
    expect(actor.getSnapshot().value).toBe('loaded')
    expect(actor.getSnapshot().context.shouldAutoEdit).toBe(true) // still set, but guard blocks it
    actor.stop()
  })

  it('auto-edit with draft on latest version → enters editing normally', () => {
    const actor = createTestActor({isLatest: true})
    actor.start()
    actor.send({
      type: 'draft.resolved',
      draftId: 'my-draft',
      content: [{block: {id: 'b1', type: 'Paragraph', text: 'draft text', attributes: {}}, children: []}],
      cursorPosition: null,
    })
    actor.send({type: 'document.loaded', document: mockDocument})
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    actor.stop()
  })

  it('account IDs flow through to writeDraft actor input', async () => {
    let capturedInput: any = null
    const machine = documentMachine.provide({
      actors: {
        writeDraft: fromPromise<{id: string}, any>(async ({input}) => {
          capturedInput = input
          return {id: 'draft-789'}
        }),
        publishDocument: fromPromise<HMDocument, any>(async () => mockDocument),
      },
      delays: {
        autosaveTimeout: 10,
        saveIndicatorDismiss: 10,
      },
    })
    const actor = createActor(machine, {
      input: {documentId: mockDocumentId, canEdit: true, signingAccountId: 'my-account'},
    })
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'draft.resolved', draftId: null, content: null, cursorPosition: null})
    actor.send({type: 'edit.start'})
    actor.send({type: 'change'})
    await new Promise((r) => setTimeout(r, 100))
    expect(capturedInput).not.toBeNull()
    expect(capturedInput.signingAccountId).toBe('my-account')
    actor.stop()
  })
})
