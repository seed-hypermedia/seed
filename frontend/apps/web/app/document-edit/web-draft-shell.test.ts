import {describe, expect, it} from 'vitest'

import {shouldBypassServerDocumentFetchForWebDraftShell, shouldUseLocalWebDraftShell} from './web-draft-shell'

describe('web draft shell routing', () => {
  it('bypasses server fetch for public placeholder draft URLs only', () => {
    expect(
      shouldBypassServerDocumentFetchForWebDraftShell({
        path: ['parent', '-draft-1'],
        isInspect: false,
        version: null,
      }),
    ).toBe(true)
    expect(
      shouldBypassServerDocumentFetchForWebDraftShell({
        path: ['parent', '-draft-1'],
        isInspect: true,
        version: null,
      }),
    ).toBe(false)
    expect(
      shouldBypassServerDocumentFetchForWebDraftShell({
        path: ['parent', '-draft-1'],
        isInspect: false,
        version: 'v1',
      }),
    ).toBe(false)
  })

  it('does not bypass server fetch for private generated paths after publish/reload', () => {
    expect(
      shouldBypassServerDocumentFetchForWebDraftShell({path: ['-private-draft-1'], isInspect: false, version: null}),
    ).toBe(false)
  })

  it('uses the local draft shell only while a matching draft is loading, present, or reserved', () => {
    expect(
      shouldUseLocalWebDraftShell({
        placeholderDraftId: 'private-draft-1',
        isDraftLoading: true,
        hasDraft: false,
        isReservedDraft: false,
      }),
    ).toBe(true)
    expect(
      shouldUseLocalWebDraftShell({
        placeholderDraftId: 'private-draft-1',
        isDraftLoading: false,
        hasDraft: true,
        isReservedDraft: false,
      }),
    ).toBe(true)
    expect(
      shouldUseLocalWebDraftShell({
        placeholderDraftId: 'private-draft-1',
        isDraftLoading: false,
        hasDraft: false,
        isReservedDraft: true,
      }),
    ).toBe(true)
    expect(
      shouldUseLocalWebDraftShell({
        placeholderDraftId: 'private-draft-1',
        isDraftLoading: false,
        hasDraft: false,
        isReservedDraft: false,
      }),
    ).toBe(false)
  })
})
