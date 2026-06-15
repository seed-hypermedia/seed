import {describe, expect, it} from 'vitest'
import {shouldRequirePublishForBlockAction} from './document-editor'

describe('shouldRequirePublishForBlockAction', () => {
  it('does not require publishing for a block that exists in the published version while editing a draft', () => {
    expect(
      shouldRequirePublishForBlockAction({
        blockId: 'published-block',
        isUnpublishedDraft: true,
        isBlockInPublishedVersion: (blockId) => blockId === 'published-block',
      }),
    ).toBe(false)
  })

  it('requires publishing for a draft-only block while editing a draft', () => {
    expect(
      shouldRequirePublishForBlockAction({
        blockId: 'draft-block',
        isUnpublishedDraft: true,
        isBlockInPublishedVersion: (blockId) => blockId === 'published-block',
      }),
    ).toBe(true)
  })

  it('requires publishing for an unpublished draft when no published-block predicate is available', () => {
    expect(
      shouldRequirePublishForBlockAction({
        blockId: 'unknown-block',
        isUnpublishedDraft: true,
      }),
    ).toBe(true)
  })
})
