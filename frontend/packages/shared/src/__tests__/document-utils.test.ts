import {describe, expect, it, vi} from 'vitest'
import {Comment, Document} from '../client'
import {prepareHMComment, prepareHMDocument} from '../document-utils'

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
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error parsing document'),
      expect.any(Object),
    )

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
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error parsing comment'),
      expect.any(Object),
    )

    consoleSpy.mockRestore()
  })
})
