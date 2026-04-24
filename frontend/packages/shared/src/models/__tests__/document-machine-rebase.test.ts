import {HMDocument, HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {createActor, fromPromise} from 'xstate'
import {documentMachine, DocumentMachineInput} from '../document-machine'

const documentId = {
  id: 'hm://z6Mktest/doc',
  uid: 'z6Mktest',
  path: ['doc'],
  version: null,
  blockRef: null,
  blockRange: null,
  hostname: null,
  scheme: 'hm',
} as DocumentMachineInput['documentId']

const baseBlocks: HMBlockNode[] = [
  {block: {type: 'Paragraph', id: 'b1', text: 'one', attributes: {}} as HMBlockNode['block'], children: []},
  {block: {type: 'Paragraph', id: 'b2', text: 'two', attributes: {}} as HMBlockNode['block'], children: []},
]

const baseDocument = {
  content: baseBlocks,
  version: 'baseVersion',
  account: 'z6Mktest',
  authors: ['z6Mktest'],
  path: '/doc',
  createTime: '2025-01-01T00:00:00Z',
  updateTime: '2025-01-01T00:00:00Z',
  metadata: {name: 'Test Doc'},
  genesis: 'bafygenesis',
  visibility: 'PUBLIC',
} as unknown as HMDocument

const remoteDocument = {
  ...baseDocument,
  version: 'remoteVersion',
  content: [
    {block: {type: 'Paragraph', id: 'b1', text: 'one updated', attributes: {}} as HMBlockNode['block'], children: []},
    {block: {type: 'Paragraph', id: 'b2', text: 'two', attributes: {}} as HMBlockNode['block'], children: []},
  ],
} as unknown as HMDocument

function createTestActor() {
  const machine = documentMachine.provide({
    actors: {
      writeDraft: fromPromise<{id: string}, any>(async () => ({id: 'draft-123'})),
      publishDocument: fromPromise<HMDocument, any>(async () => remoteDocument),
    },
    delays: {saveIndicatorDismiss: 50},
  })
  return createActor(machine, {input: {documentId, canEdit: true}})
}

function enterEditing(actor: ReturnType<typeof createTestActor>) {
  actor.start()
  actor.send({type: 'document.loaded', document: baseDocument})
  actor.send({type: 'draft.resolved', draftId: null, content: null, cursorPosition: null})
  actor.send({type: 'edit.start'})
}

describe('documentMachine rebase transitions', () => {
  it('snapshots baseBlocks when entering editing', () => {
    const actor = createTestActor()
    enterEditing(actor)
    expect(actor.getSnapshot().context.baseBlocks).toEqual(baseBlocks)
    expect(actor.getSnapshot().context.mineTouchedIds).toEqual([])
    actor.stop()
  })

  it('rebase.blockTouched accumulates unique block ids', () => {
    const actor = createTestActor()
    enterEditing(actor)
    actor.send({type: 'rebase.blockTouched', blockIds: ['b1', 'b2']})
    actor.send({type: 'rebase.blockTouched', blockIds: ['b1', 'b3']})
    expect(actor.getSnapshot().context.mineTouchedIds.sort()).toEqual(['b1', 'b2', 'b3'])
    actor.stop()
  })

  it('document.remoteUpdate stashes pendingRemoteDocument + version', () => {
    const actor = createTestActor()
    enterEditing(actor)
    actor.send({type: 'document.remoteUpdate', document: remoteDocument})
    const ctx = actor.getSnapshot().context
    expect(ctx.pendingRemoteDocument).toBe(remoteDocument)
    expect(ctx.pendingRemoteVersion).toBe('remoteVersion')
    // Still in editing (rebase detection/apply happens outside machine)
    expect(actor.getSnapshot().value).toEqual({editing: {draft: 'idle', saveIndicator: 'hidden'}})
    actor.stop()
  })

  it('rebase.apply commits merged blocks + clears pending + updates deps', () => {
    const actor = createTestActor()
    enterEditing(actor)
    actor.send({type: 'document.remoteUpdate', document: remoteDocument})
    actor.send({type: 'rebase.blockTouched', blockIds: ['b1']})
    const merged = remoteDocument.content
    actor.send({type: 'rebase.apply', mergedBlocks: merged, newDocument: remoteDocument})
    const ctx = actor.getSnapshot().context
    expect(ctx.document).toBe(remoteDocument)
    expect(ctx.publishedVersion).toBe('remoteVersion')
    expect(ctx.deps).toEqual(['remoteVersion'])
    expect(ctx.baseBlocks).toBe(merged)
    expect(ctx.mineTouchedIds).toEqual([])
    expect(ctx.pendingRemoteDocument).toBeNull()
    expect(ctx.pendingRemoteVersion).toBeNull()
    expect(ctx.pendingRebase).toBeNull()
    actor.stop()
  })

  it('rebase.detectConflict stores pendingRebase without transitioning', () => {
    const actor = createTestActor()
    enterEditing(actor)
    actor.send({type: 'document.remoteUpdate', document: remoteDocument})
    actor.send({
      type: 'rebase.detectConflict',
      conflictedBlockIds: ['b1'],
      author: 'Alice',
    })
    const ctx = actor.getSnapshot().context
    expect(ctx.pendingRebase).toEqual({
      kind: 'conflict',
      conflictedBlockIds: ['b1'],
      author: 'Alice',
    })
    expect(ctx.pendingRemoteDocument).toBe(remoteDocument)
    actor.stop()
  })

  it('rebase.dismiss clears pendingRebase but keeps pendingRemoteDocument', () => {
    const actor = createTestActor()
    enterEditing(actor)
    actor.send({type: 'document.remoteUpdate', document: remoteDocument})
    actor.send({
      type: 'rebase.detectConflict',
      conflictedBlockIds: ['b1'],
      author: 'Alice',
    })
    actor.send({type: 'rebase.dismiss'})
    const ctx = actor.getSnapshot().context
    expect(ctx.pendingRebase).toBeNull()
    expect(ctx.pendingRemoteDocument).toBe(remoteDocument)
    actor.stop()
  })

  it('edit.cancel clears all rebase state', () => {
    const actor = createTestActor()
    enterEditing(actor)
    actor.send({type: 'document.remoteUpdate', document: remoteDocument})
    actor.send({type: 'rebase.blockTouched', blockIds: ['b1']})
    actor.send({
      type: 'rebase.detectConflict',
      conflictedBlockIds: ['b1'],
      author: 'Alice',
    })
    actor.send({type: 'edit.cancel'})
    const ctx = actor.getSnapshot().context
    expect(ctx.mineTouchedIds).toEqual([])
    expect(ctx.pendingRemoteDocument).toBeNull()
    expect(ctx.pendingRebase).toBeNull()
    expect(ctx.baseBlocks).toBeNull()
    actor.stop()
  })
})
