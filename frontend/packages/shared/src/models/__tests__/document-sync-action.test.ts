import {describe, expect, it} from 'vitest'
import {resolveDocumentSyncAction} from '../use-document-machine'

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

  it('still applies a genuine remote edit that carries a new version', () => {
    expect(resolveDocumentSyncAction('v2', new Set(['v1', 'v2']), 'v3')).toBe('remoteUpdate')
  })
})
