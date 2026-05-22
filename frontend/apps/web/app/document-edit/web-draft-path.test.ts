import {describe, expect, it} from 'vitest'

import {
  getWebDraftPlaceholderId,
  isWebDraftPlaceholderPath,
  shouldBypassServerDocumentFetchForWebDraftPath,
} from './web-draft-path'

describe('web draft placeholder paths', () => {
  it('extracts a draft id from the final placeholder segment', () => {
    expect(getWebDraftPlaceholderId(['parent', '-draft-1'])).toBe('draft-1')
    expect(getWebDraftPlaceholderId(['parent', 'child'])).toBeNull()
  })

  it('matches a specific placeholder draft id', () => {
    expect(isWebDraftPlaceholderPath(['parent', '-draft-1'], 'draft-1')).toBe(true)
    expect(isWebDraftPlaceholderPath(['parent', '-draft-1'], 'draft-2')).toBe(false)
  })

  it('bypasses server fetch only for unversioned non-inspect placeholder URLs', () => {
    expect(
      shouldBypassServerDocumentFetchForWebDraftPath({path: ['parent', '-draft-1'], isInspect: false, version: null}),
    ).toBe(true)
    expect(
      shouldBypassServerDocumentFetchForWebDraftPath({path: ['parent', '-draft-1'], isInspect: true, version: null}),
    ).toBe(false)
    expect(
      shouldBypassServerDocumentFetchForWebDraftPath({path: ['parent', '-draft-1'], isInspect: false, version: 'v1'}),
    ).toBe(false)
  })
})
