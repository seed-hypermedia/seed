import {describe, expect, it, vi} from 'vitest'
import {Comment, Document} from '../client'
import {
  canCreateChildDocuments,
  disablePreparedDocumentCache,
  enablePreparedDocumentCache,
  prepareHMComment,
  prepareHMDocument,
} from '../document-utils'

describe('canCreateChildDocuments', () => {
  it('allows child creation for public documents without a private draft', () => {
    expect(canCreateChildDocuments('PUBLIC')).toBe(true)
  })

  it('blocks child creation for private published documents', () => {
    expect(canCreateChildDocuments('PRIVATE')).toBe(false)
  })

  it('blocks child creation when the local draft is private', () => {
    expect(canCreateChildDocuments('PUBLIC', 'PRIVATE')).toBe(false)
  })
})

describe('prepareHMDocument', () => {
  it('returns parsed document when schema validation succeeds', () => {
    const mockDoc = {
      toJson: () => ({
        path: '/test/path',
        metadata: {
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        content: [],
        version: '1.0',
        account: 'test-account',
        authors: ['author1'],
        genesis: 'genesis-id',
        visibility: 'PUBLIC',
        createTime: '2024-01-01T00:00:00Z',
        updateTime: '2024-01-01T00:00:00Z',
      }),
    } as unknown as Document

    const result = prepareHMDocument(mockDoc)
    expect(result).toBeDefined()
    expect(result.account).toBeDefined()
    expect(result.account).toBe('test-account')
  })

  it('returns document even when schema validation fails', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const mockDoc = {
      toJson: () => ({
        id: 'test-doc',
        metadata: {
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        content: [
          {
            block: {
              type: 'InvalidType', // This should cause schema validation to fail
              text: 'test',
              annotations: [
                {
                  type: 'Link',
                  // Missing required 'link' field for Link annotation
                },
              ],
            },
          },
        ],
      }),
    } as unknown as Document

    const result = prepareHMDocument(mockDoc)

    // Should not throw, but return the document
    expect(result).toBeDefined()
    expect(result.content).toBeDefined()

    // Should have logged the error
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error parsing document'), expect.any(Object))

    consoleSpy.mockRestore()
  })

  it('handles malformed annotations gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const mockDoc = {
      toJson: () => ({
        id: 'test-doc',
        metadata: {
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        content: [
          {
            block: {
              type: 'Paragraph',
              text: 'test',
              annotations: [
                null, // null annotation
                undefined, // undefined annotation
                {
                  type: 'Embed',
                  // Missing required 'link' field for Embed - should be filtered out
                },
                {
                  type: 'Link',
                  // Missing link field - should get empty string fallback
                },
              ],
            },
          },
        ],
      }),
    } as unknown as Document

    const result = prepareHMDocument(mockDoc)

    // Should not throw
    expect(result).toBeDefined()
    expect(result.content).toBeDefined()

    consoleSpy.mockRestore()
  })
})

describe('prepareHMComment', () => {
  it('returns parsed comment when schema validation succeeds', () => {
    const mockComment = {
      toJson: () => ({
        id: 'test-comment',
        metadata: {
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        content: [],
        version: '1.0',
        author: 'test-author',
        targetAccount: 'target-account',
        targetVersion: 'target-version',
        visibility: 'PUBLIC',
        createTime: '2024-01-01T00:00:00Z',
        updateTime: '2024-01-01T00:00:00Z',
      }),
    } as unknown as Comment

    const result = prepareHMComment(mockComment)
    expect(result).toBeDefined()
    expect(result.content).toBeDefined()
    expect(result.author).toBe('test-author')
  })

  it('returns comment even when schema validation fails', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const mockComment = {
      toJson: () => ({
        id: 'test-comment',
        metadata: {
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        content: [
          {
            block: {
              type: 'InvalidCommentType',
              text: 'test',
            },
          },
        ],
      }),
    } as unknown as Comment

    const result = prepareHMComment(mockComment)

    // Should not throw, but return the comment
    expect(result).toBeDefined()
    expect(result.content).toBeDefined()

    // Should have logged the error
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error parsing comment'), expect.any(Object))

    consoleSpy.mockRestore()
  })
})

describe('prepareHMDocument cache', () => {
  function apiDoc(fields: {version: string; path?: string; generation?: bigint; name?: string}) {
    const toJson = vi.fn(() => ({
      path: fields.path ?? '/a',
      metadata: {name: fields.name ?? 'Doc'},
      content: [],
      version: fields.version,
      account: 'acct',
      authors: ['acct'],
      genesis: 'g',
      visibility: 'PUBLIC',
      createTime: '2024-01-01T00:00:00Z',
      updateTime: '2024-01-01T00:00:00Z',
    }))
    const doc = {
      account: 'acct',
      path: fields.path ?? '/a',
      version: fields.version,
      visibility: 1,
      generationInfo: fields.generation === undefined ? undefined : {genesis: 'g', generation: fields.generation},
      toJson,
    } as unknown as Document
    return {doc, toJson}
  }

  it('is off by default: every call converts and validates again', () => {
    const {doc, toJson} = apiDoc({version: 'v1'})
    const a = prepareHMDocument(doc)
    const b = prepareHMDocument(doc)
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
    expect(toJson).toHaveBeenCalledTimes(2)
  })

  it('when enabled, reuses the prepared document for the same version only', () => {
    enablePreparedDocumentCache(2)
    try {
      const first = apiDoc({version: 'v1'})
      const again = apiDoc({version: 'v1'})
      const prepared = prepareHMDocument(first.doc)
      expect(prepareHMDocument(again.doc)).toBe(prepared)
      expect(again.toJson).not.toHaveBeenCalled()

      // A new version, path or generation is a different document.
      expect(prepareHMDocument(apiDoc({version: 'v2', name: 'New'}).doc).metadata.name).toBe('New')
      expect(prepareHMDocument(apiDoc({version: 'v1', path: '/b'}).doc)).not.toBe(prepared)
      expect(prepareHMDocument(apiDoc({version: 'v1', generation: 5n}).doc)).not.toBe(prepared)

      // Documents without a version are never cached.
      const unversioned = apiDoc({version: ''})
      prepareHMDocument(unversioned.doc)
      prepareHMDocument(unversioned.doc)
      expect(unversioned.toJson).toHaveBeenCalledTimes(2)

      // Bounded: the oldest entry was evicted.
      const evicted = apiDoc({version: 'v1'})
      expect(prepareHMDocument(evicted.doc)).not.toBe(prepared)
      expect(evicted.toJson).toHaveBeenCalledTimes(1)
    } finally {
      disablePreparedDocumentCache()
    }
  })
})
