import {describe, expect, it} from 'vitest'
import {selectIsUnpublishedDraft} from '../use-document-machine'
import type {DocumentMachineSnapshot} from '../use-document-machine'

function snapshot(document: any): DocumentMachineSnapshot {
  return {context: {document}} as unknown as DocumentMachineSnapshot
}

describe('selectIsUnpublishedDraft', () => {
  it('returns false when document context is null (still loading)', () => {
    expect(selectIsUnpublishedDraft(snapshot(null))).toBe(false)
  })

  it('returns true when document version is empty (placeholder for new doc)', () => {
    expect(
      selectIsUnpublishedDraft(
        snapshot({
          version: '',
          content: [],
          metadata: {},
          account: 'acct',
          path: '/x',
        }),
      ),
    ).toBe(true)
  })

  it('returns true when document version is missing entirely', () => {
    expect(
      selectIsUnpublishedDraft(
        snapshot({
          content: [],
          metadata: {},
          account: 'acct',
          path: '/x',
        }),
      ),
    ).toBe(true)
  })

  it('returns false for a published private document with a real version (-prefix path)', () => {
    // Private docs are PUBLISHED with auto-generated `-`-prefix paths.
    // The selector must NOT treat them as drafts — they have real versions.
    expect(
      selectIsUnpublishedDraft(
        snapshot({
          version: 'bafyabc.bafydef',
          content: [],
          metadata: {},
          account: 'acct',
          path: '/-TWLswGF5TvO9tCnnkwOG',
          visibility: 'PRIVATE',
        }),
      ),
    ).toBe(false)
  })

  it('returns false for a normal published document', () => {
    expect(
      selectIsUnpublishedDraft(
        snapshot({
          version: 'bafyabc',
          content: [],
          metadata: {name: 'Hi'},
          account: 'acct',
          path: '/hi',
        }),
      ),
    ).toBe(false)
  })
})
