// @vitest-environment jsdom
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  DocumentMachineProvider,
  resolveDocumentSyncAction,
  selectDocument,
  useDocumentSend,
  useDocumentSelector,
  useDocumentSync,
} from '../use-document-machine'

describe('resolveDocumentSyncAction', () => {
  it('loads the first resolved document', () => {
    expect(resolveDocumentSyncAction(null, new Set(), 'v1')).toBe('loaded')
  })

  it('loads late when the first document had no version yet', () => {
    expect(resolveDocumentSyncAction('', new Set(['']), 'v1')).toBe('loaded')
  })

  it('applies a forward version change as a remote update', () => {
    expect(resolveDocumentSyncAction('v1', new Set(['v1']), 'v2')).toBe('remoteUpdate')
  })

  it('does nothing when the version is unchanged', () => {
    expect(resolveDocumentSyncAction('v1', new Set(['v1']), 'v1')).toBe('skip')
  })

  it('ignores a revert to an already-seen, superseded version (stale post-publish refetch)', () => {
    // Published v2 (current), then a lagging "latest" refetch returns the old v1.
    expect(resolveDocumentSyncAction('v2', new Set(['v1', 'v2']), 'v1')).toBe('skip')
  })

  it('applies a previously seen version when document version navigation selected it', () => {
    expect(resolveDocumentSyncAction('v1', new Set(['v1', 'v2']), 'v2', true)).toBe('remoteUpdate')
  })

  it('still applies a genuine remote edit that carries a new version', () => {
    expect(resolveDocumentSyncAction('v2', new Set(['v1', 'v2']), 'v3')).toBe('remoteUpdate')
  })
})

describe('useDocumentSync', () => {
  const documentId = {
    id: 'hm://alice/doc',
    uid: 'alice',
    path: ['doc'],
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: 'hm',
  } as any
  const latestDocument = {
    account: 'alice',
    path: '/doc',
    version: 'v2',
    content: [],
    metadata: {name: 'Latest'},
    authors: ['alice'],
    genesis: 'genesis',
    visibility: 'PUBLIC',
  } as unknown as HMDocument
  const fixedDocument = {
    ...latestDocument,
    version: 'v1',
    metadata: {name: 'Fixed'},
  }
  let container: HTMLDivElement
  let root: Root
  let syncedVersion: string | undefined
  let send: ReturnType<typeof useDocumentSend>

  function Probe({
    document,
    routeKey,
    isPlaceholderData,
  }: {
    document: HMDocument
    routeKey: string
    isPlaceholderData: boolean
  }) {
    useDocumentSync(document, routeKey, isPlaceholderData)
    send = useDocumentSend()
    syncedVersion = useDocumentSelector(selectDocument)?.version
    return null
  }

  function render(document: HMDocument, routeKey: string, isPlaceholderData: boolean) {
    act(() => {
      root.render(
        React.createElement(DocumentMachineProvider, {
          input: {documentId, canEdit: false},
          children: React.createElement(Probe, {document, routeKey, isPlaceholderData}),
        }),
      )
    })
  }

  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    syncedVersion = undefined
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('keeps rendered placeholder content out of sync until the selected version resolves', () => {
    render(latestDocument, 'latest', false)
    expect(syncedVersion).toBe('v2')
    act(() => send({type: 'draft.resolved', draftId: null, content: null, cursorPosition: null}))

    render(latestDocument, 'fixed-v1', true)
    expect(syncedVersion).toBe('v2')

    render(fixedDocument, 'fixed-v1', false)
    expect(syncedVersion).toBe('v1')

    render(fixedDocument, 'latest', true)
    expect(syncedVersion).toBe('v1')

    render(latestDocument, 'latest', false)
    expect(syncedVersion).toBe('v2')
  })
})
