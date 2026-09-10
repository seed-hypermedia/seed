import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {describe, expect, it, vi} from 'vitest'
import {createActor, fromPromise, waitFor} from 'xstate'
import type {HMBlockNode, HMDocument} from '@seed-hypermedia/client/hm-types'
import {hmId} from '../../utils/entity-id-url'
import {documentMachine, type PublishInput} from '../document-machine'
import type {ConfirmChildDeletionInput} from '../../utils/confirmed-child-deletion'

const documentId = hmId('account', {path: ['parent']})
const childId = hmId('account', {path: ['parent', 'child']})
const baseBlocks = [
  {block: {id: 'card', type: 'Embed', link: childId.id, attributes: {view: 'Card'}}, children: []},
] as HMBlockNode[]
const document = {
  account: 'account',
  path: '/parent',
  version: 'v1',
  content: baseBlocks,
  metadata: {},
  authors: [],
} as unknown as HMDocument
const confirmation = [{childId, documents: [{id: childId.id, version: 'child-v1'}]}]
function start(content: HMBlockNode[] = [], removedChildDocumentIds: string[] = []) {
  const publish = vi.fn(async (_args: {input: PublishInput}) => ({...document, version: 'v2', content}))
  const inspect = vi.fn(async (_args: {input: ConfirmChildDeletionInput}) => confirmation)
  const applyInitialContent = vi.fn()
  const placeCursor = vi.fn()
  const setEditable = vi.fn()
  const actor = createActor(
    documentMachine.provide({
      actions: {
        applyInitialContentToEditor: applyInitialContent,
        placeCursorFromPendingOrDraft: placeCursor,
        setEditorEditable: setEditable,
      },
      actors: {
        publishDocument: fromPromise(publish),
        inspectChildDeletions: fromPromise(inspect),
        writeDraft: fromPromise(async () => ({id: 'draft'})),
        discardDraft: fromPromise(async () => {}),
      },
    }),
    {input: {documentId, canEdit: true}},
  )
  actor.start()
  actor.send({type: 'document.loaded', document})
  actor.send({
    type: 'draft.resolved',
    draftId: 'draft',
    content,
    baseBlocks,
    removedChildDocumentIds,
    cursorPosition: null,
  })
  actor.send({type: 'edit.start'})
  return {actor, publish, inspect, applyInitialContent, placeCursor, setEditable}
}

describe('parent reference-removal publication confirmation', () => {
  it('does not publish before consent and passes the approved subtree to the publisher', async () => {
    const {actor, publish, inspect} = start()
    actor.send({type: 'publish.start'})
    await waitFor(actor, (snapshot) => snapshot.matches({publishing: 'confirmingChildDeletion'}))
    expect(inspect.mock.calls[0]?.[0].input).toMatchObject({parentId: documentId, childIds: [{id: childId.id}]})
    expect(publish).not.toHaveBeenCalled()
    actor.send({type: 'publish.confirmChildDeletion'})
    await waitFor(actor, (snapshot) => snapshot.matches('loaded'))
    expect(publish.mock.calls[0]?.[0].input.confirmedChildDeletions).toEqual(confirmation)
    actor.stop()
  })
  it.each(['card', 'inline link'])(
    'accepts desktop editor blocks without losing a surviving %s reference',
    async (kind) => {
      const nodes: HMBlockNode[] =
        kind === 'card'
          ? baseBlocks
          : [
              {
                block: {
                  id: 'text',
                  type: 'Paragraph',
                  text: 'Child',
                  attributes: {},
                  annotations: [{type: 'Link', link: childId.id, starts: [0], ends: [5]}],
                },
                children: [],
              },
            ]
      const content = hmBlocksToEditorContent(nodes, {childrenType: 'Group'}) as unknown as HMBlockNode[]
      const {actor, publish, inspect} = start(content)
      actor.send({type: 'publish.start'})
      await waitFor(actor, (snapshot) => snapshot.matches('loaded'))
      expect(inspect).not.toHaveBeenCalled()
      expect(publish).toHaveBeenCalledOnce()
      actor.stop()
    },
  )
  it('converts desktop editor content before inspecting removed child references', async () => {
    const nodes = [
      {block: {id: 'text', type: 'Paragraph', text: 'Updated', attributes: {}}, children: []},
    ] as HMBlockNode[]
    const content = hmBlocksToEditorContent(nodes, {childrenType: 'Group'}) as unknown as HMBlockNode[]
    const {actor, inspect} = start(content)
    actor.send({type: 'publish.start'})
    await waitFor(actor, (snapshot) => snapshot.matches({publishing: 'confirmingChildDeletion'}))
    expect(inspect.mock.calls[0]?.[0].input.content?.[0]?.block).toMatchObject({id: 'text', type: 'Paragraph'})
    actor.stop()
  })
  it('does not ask to delete a child when a self-query replaces its card', async () => {
    const query = [
      {
        block: {
          id: 'query',
          type: 'Query',
          attributes: {query: {includes: [{space: documentId.uid, path: '/parent', mode: 'Children'}]}},
        },
        children: [],
      },
    ] as unknown as HMBlockNode[]
    const {actor, publish, inspect} = start(query, [childId.id, 'https://example.test/child'])
    actor.send({type: 'publish.start'})
    await waitFor(actor, (snapshot) => snapshot.matches('loaded'))
    expect(inspect).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledOnce()
    actor.stop()
  })
  it('inspects children before publishing removal of the published self-query', async () => {
    const query = [
      {
        block: {
          id: 'query',
          type: 'Query',
          attributes: {query: {includes: [{space: documentId.uid, path: '/parent', mode: 'Children'}]}},
        },
        children: [],
      },
    ] as unknown as HMBlockNode[]
    const {actor, publish, inspect} = start()
    actor.send({type: 'rebase.apply', newDocument: {...document, content: query}, mergedBlocks: []})
    actor.send({type: 'publish.start'})
    await waitFor(actor, (snapshot) => snapshot.matches({publishing: 'confirmingChildDeletion'}))
    expect(inspect.mock.calls[0]?.[0].input).toMatchObject({removedSelfQuery: true, content: []})
    expect(publish).not.toHaveBeenCalled()
    actor.stop()
  })
  it('remembers authored deletion of a newly inserted reference even with an empty published baseline', async () => {
    const {actor, publish} = start()
    actor.send({type: 'rebase.apply', newDocument: {...document, content: []}, mergedBlocks: []})
    actor.send({type: 'childReferences.removed', documentIds: [childId.id]})
    actor.send({type: 'publish.start'})
    await waitFor(actor, (snapshot) => snapshot.matches({publishing: 'confirmingChildDeletion'}))
    expect(publish).not.toHaveBeenCalled()
    actor.stop()
  })
  it('restores authored intent from disk and clears it on discard', async () => {
    const {actor} = start([], [childId.id])
    expect(actor.getSnapshot().context.removedChildDocumentIds).toEqual([childId.id])
    actor.send({type: 'edit.discard'})
    await waitFor(actor, (snapshot) => snapshot.matches('loaded'))
    expect(actor.getSnapshot().context.removedChildDocumentIds).toEqual([])
    actor.stop()
  })
  it('cancellation leaves the draft without executing a deletion or publication', async () => {
    const {actor, publish} = start()
    actor.send({type: 'publish.start'})
    await waitFor(actor, (snapshot) => snapshot.matches({publishing: 'confirmingChildDeletion'}))
    actor.send({type: 'publish.cancelChildDeletion'})
    expect(actor.getSnapshot().matches('editing')).toBe(true)
    expect(actor.getSnapshot().context.draftContent).toEqual([])
    expect(publish).not.toHaveBeenCalled()
    actor.stop()
  })
  it('does not inspect or confirm when a reference survives (including undo)', async () => {
    const {actor, publish, inspect} = start(baseBlocks)
    actor.send({type: 'childReferences.removed', documentIds: [childId.id]})
    actor.send({type: 'publish.start'})
    await waitFor(actor, (snapshot) => snapshot.matches('loaded'))
    expect(inspect).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledOnce()
    actor.stop()
  })
})

it.each(['confirmingChildDeletion', 'childDeletionFailed'] as const)(
  'resumes the existing editor after %s without replacing content or selection',
  async (reviewState) => {
    const {actor, inspect, applyInitialContent, placeCursor, setEditable} = start()
    if (reviewState === 'childDeletionFailed') inspect.mockRejectedValueOnce(new Error('offline'))
    applyInitialContent.mockClear()
    placeCursor.mockClear()
    setEditable.mockClear()
    actor.send({type: 'publish.start'})
    await waitFor(actor, (snapshot) => snapshot.matches({publishing: reviewState}))
    actor.send({type: 'publish.cancelChildDeletion'})
    expect(actor.getSnapshot().matches('editing')).toBe(true)
    expect(setEditable).toHaveBeenCalledOnce()
    expect(applyInitialContent).not.toHaveBeenCalled()
    expect(placeCursor).not.toHaveBeenCalled()
    actor.stop()
  },
)
