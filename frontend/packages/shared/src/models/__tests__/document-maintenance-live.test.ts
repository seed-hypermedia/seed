import {describe, expect, it, vi} from 'vitest'
import {createActor, fromPromise} from 'xstate'
import {hmId} from '../../utils/entity-id-url'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {documentMachine, reconcileLiveDocumentMaintenance} from '../document-machine'

const paragraph = (text: string): HMBlockNode => ({
  block: {id: 'text', type: 'Paragraph', text, attributes: {}},
  children: [],
})
const card = (link: string): HMBlockNode => ({
  block: {id: 'card', type: 'Embed', link, attributes: {view: 'Card'}},
  children: [],
})

describe('live document maintenance', () => {
  const before = [paragraph('Saved'), card('hm://account/parent/a')]
  const after = [paragraph('Saved'), card('hm://account/parent/b')]
  const context = {
    draftId: 'draft',
    metadata: {name: 'Live title'},
    draftContent: before,
    baseBlocks: before,
    mineTouchedIds: [],
    removedChildDocumentIds: [],
    hasChangedWhileSaving: true,
  } as any
  const event = {
    type: 'draft.externallyModified',
    source: 'document-card-cleanup',
    draftId: 'draft',
    operation: 'rewrite',
    sourceDocumentId: 'hm://account/parent/a',
    targetDocumentId: 'hm://account/parent/b',
    previousContent: before,
    content: after,
    baseBlocks: after,
    deps: ['new-head'],
    metadata: {name: 'Saved title'},
    publishedDocument: {content: after, version: 'new-head'},
  } as any

  it('preserves unsaved text and metadata while applying a renamed card and published baseline', () => {
    const patch = reconcileLiveDocumentMaintenance(context, event, [paragraph('Unsaved'), before[1]!])
    expect(patch.draftContent?.[0]?.block).toMatchObject({text: 'Unsaved'})
    expect(patch.draftContent?.[1]?.block).toMatchObject({link: 'hm://account/parent/b'})
    expect(patch.metadata).toEqual({name: 'Live title'})
    expect(patch.baseBlocks).toEqual(after)
    expect(patch.deps).toEqual(['new-head'])
    expect(patch.hasChangedWhileSaving).toBe(true)
    expect(patch.editorBaseline?.[1]?.props).toMatchObject({url: 'hm://account/parent/b'})
  })

  it('keeps a live card deletion while advancing the discard baseline to its renamed path', () => {
    const patch = reconcileLiveDocumentMaintenance(context, event, [before[0]!])
    expect(patch.draftContent?.map((node) => node.block.id)).toEqual(['text'])
    expect(patch.baseBlocks?.[1]?.block).toMatchObject({link: 'hm://account/parent/b'})
  })

  it('refuses unrelated conflicting edits rather than overwriting the live editor', () => {
    expect(() =>
      reconcileLiveDocumentMaintenance(context, {...event, content: [paragraph('Other editor'), after[1]]}, [
        paragraph('Unsaved'),
        before[1]!,
      ]),
    ).toThrow('conflicting')
  })

  it('uses the reconciled stored content when no live editor is mounted', () => {
    const currentSaved = [paragraph('Saved since mount'), after[1]!]
    const patch = reconcileLiveDocumentMaintenance(context, {...event, content: currentSaved}, null)
    expect(patch.draftContent).toEqual(currentSaved)
  })

  it('does not restore metadata removed in the live session', () => {
    const patch = reconcileLiveDocumentMaintenance({...context, metadata: {}}, event, before)
    expect(patch.metadata).toEqual({})
  })

  it('adopts a new maintenance epoch and ignores duplicate or stale notifications', () => {
    const patch = reconcileLiveDocumentMaintenance(
      {...context, maintenanceRevision: 1},
      {...event, maintenanceRevision: 2},
      before,
    )
    expect(patch.maintenanceRevision).toBe(2)
    expect(
      reconcileLiveDocumentMaintenance(
        {...context, maintenanceRevision: 2},
        {...event, maintenanceRevision: 2},
        before,
      ),
    ).toEqual({})
    expect(
      reconcileLiveDocumentMaintenance(
        {...context, maintenanceRevision: 3},
        {...event, maintenanceRevision: 2},
        before,
      ),
    ).toEqual({})
  })

  it('preserves live edits if intermediate maintenance snapshots were missed', () => {
    expect(() =>
      reconcileLiveDocumentMaintenance(
        {...context, maintenanceRevision: 0},
        {...event, maintenanceRevision: 2},
        before,
      ),
    ).toThrow('intermediate')
    expect(
      reconcileLiveDocumentMaintenance({...context, maintenanceRevision: 0}, {...event, maintenanceRevision: 2}, null)
        .maintenanceRevision,
    ).toBe(2)
  })

  it('ignores maintenance for a different draft', () => {
    expect(reconcileLiveDocumentMaintenance(context, {...event, draftId: 'other'}, [])).toEqual({})
  })
})

it('retries a stale in-flight save when maintenance or editing changed its inputs', async () => {
  vi.useFakeTimers()
  let rejectFirst!: (error: Error) => void
  let calls = 0
  const actor = createActor(
    documentMachine.provide({
      actors: {
        writeDraft: fromPromise(async () => {
          calls++
          if (calls === 1)
            await new Promise((_, reject) => {
              rejectFirst = reject
            })
          return {id: 'draft'}
        }),
      },
    }),
    {input: {documentId: hmId('account', {path: ['parent']}), existingDraftId: 'draft', canEdit: true}},
  )
  try {
    actor.start()
    actor.send({type: 'document.loaded', document: {content: [], version: 'old', metadata: {}} as any})
    actor.send({type: 'draft.resolved', draftId: 'draft', content: [], deps: ['old'], cursorPosition: null})
    actor.send({type: 'edit.start'})
    actor.send({type: 'change'})
    await vi.advanceTimersByTimeAsync(500)
    expect(calls).toBe(1)
    actor.send({type: 'change'})
    rejectFirst(new Error('Draft baseline changed'))
    await vi.runAllTimersAsync()
    expect(calls).toBe(2)
  } finally {
    actor.stop()
    vi.useRealTimers()
  }
})
