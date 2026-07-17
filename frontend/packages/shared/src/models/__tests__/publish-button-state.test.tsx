// @vitest-environment jsdom
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {createElement} from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {fromPromise} from 'xstate'
import {documentMachine} from '../document-machine'
import {DocumentMachineProvider, useDocumentSend} from '../use-document-machine'
import {useUnpublishedChangeCount} from '../use-unpublished-change-count'

const mockDocumentId = {
  id: 'hm://z6Mktest/doc',
  uid: 'z6Mktest',
  path: ['doc'],
  version: null,
  blockRef: null,
  blockRange: null,
  hostname: null,
  scheme: 'hm',
} as any

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

/** A machine whose publish returns the doc with the edited metadata + a new version. */
function mockMachine() {
  return documentMachine.provide({
    actors: {
      writeDraft: fromPromise<{id: string}, any>(async () => ({id: 'draft-123'})),
      publishDocument: fromPromise<HMDocument, any>(async ({input}: any) => ({
        ...mockDocument,
        version: 'bafynew',
        metadata: {...mockDocument.metadata, ...(input?.metadata ?? {})},
      })),
      discardDraft: fromPromise<void, any>(async () => {}),
    },
  })
}

let container: HTMLDivElement
let root: Root
let changeCount = -1
let send: (event: any) => void = () => {}

function Probe() {
  changeCount = useUnpublishedChangeCount()
  send = useDocumentSend()
  return null
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  changeCount = -1
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const flush = (ms = 0) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })

describe('publish button state after publishing an attribute edit', () => {
  it('resets the unpublished change count to 0 after publishing metadata', async () => {
    act(() => {
      root.render(
        createElement(
          DocumentMachineProvider,
          {machine: mockMachine(), input: {documentId: mockDocumentId, canEdit: true}},
          createElement(Probe),
        ),
      )
    })

    act(() => send({type: 'document.loaded', document: mockDocument}))
    act(() => send({type: 'draft.resolved', draftId: null, content: null, cursorPosition: null}))
    act(() => send({type: 'edit.start'}))
    act(() => send({type: 'change', metadata: {name: 'Edited Title'}}))

    // While editing an attribute there is exactly one pending change → green button.
    expect(changeCount).toBe(1)

    act(() => send({type: 'publish.start'}))
    await flush(60)

    // After publishing, there is nothing left to publish → the button greys out.
    expect(changeCount).toBe(0)
  })
})
