import {HMDocument} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it, vi} from 'vitest'
import {createActor, fromPromise} from 'xstate'
import {documentMachine, DocumentMachineInput} from '../document-machine'
import {selectCanEdit, selectIsEditing} from '../use-document-machine'

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
  version: 'bafyabc',
  account: 'z6Mktest',
  authors: ['z6Mktest'],
  path: '/doc',
  createTime: '2025-01-01T00:00:00Z',
  updateTime: '2025-01-01T00:00:00Z',
  metadata: {name: 'Test Doc'},
  genesis: 'bafygenesis',
  visibility: 'PUBLIC',
} as unknown as HMDocument

function createActorForGate(canEdit: boolean) {
  const machine = documentMachine.provide({
    actors: {
      writeDraft: fromPromise<{id: string}, any>(async () => ({id: 'draft-123'})),
      publishDocument: fromPromise<HMDocument, any>(async () => mockDocument),
    },
  })
  return createActor(machine, {input: {documentId: mockDocumentId, canEdit}})
}

/**
 * `useEditorGate().beginEditIfNeeded()` is a thin closure over the actor:
 *   - read snapshot
 *   - if !canEdit -> no-op
 *   - if isEditing -> no-op
 *   - else send edit.start
 * Replicated here without a React renderer so we can exercise the logic
 * deterministically.
 */
function beginEditIfNeeded(actor: ReturnType<typeof createActorForGate>) {
  const snapshot = actor.getSnapshot()
  if (!selectCanEdit(snapshot)) return
  if (selectIsEditing(snapshot)) return
  actor.send({type: 'edit.start'})
}

describe('useEditorGate / beginEditIfNeeded semantics', () => {
  it('does nothing when the user cannot edit', () => {
    const actor = createActorForGate(false)
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'draft.resolved', draftId: null, content: null, cursorPosition: null})
    const sendSpy = vi.spyOn(actor, 'send')
    beginEditIfNeeded(actor)
    expect(sendSpy).not.toHaveBeenCalled()
    expect(actor.getSnapshot().matches('editing')).toBe(false)
    actor.stop()
  })

  it('sends edit.start when the user can edit and the machine is loaded', () => {
    const actor = createActorForGate(true)
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'draft.resolved', draftId: null, content: null, cursorPosition: null})
    expect(actor.getSnapshot().matches('loaded')).toBe(true)
    beginEditIfNeeded(actor)
    expect(actor.getSnapshot().matches('editing')).toBe(true)
    actor.stop()
  })

  it('is idempotent — calling while already editing is a no-op', () => {
    const actor = createActorForGate(true)
    actor.start()
    actor.send({type: 'document.loaded', document: mockDocument})
    actor.send({type: 'draft.resolved', draftId: null, content: null, cursorPosition: null})
    beginEditIfNeeded(actor)
    expect(actor.getSnapshot().matches('editing')).toBe(true)
    const sendSpy = vi.spyOn(actor, 'send')
    beginEditIfNeeded(actor)
    expect(sendSpy).not.toHaveBeenCalled()
    expect(actor.getSnapshot().matches('editing')).toBe(true)
    actor.stop()
  })
})
