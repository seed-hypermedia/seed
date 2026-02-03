import {HMBlockNode, HMDocument, hmId} from '@shm/shared'
import {describe, expect, it, vi} from 'vitest'
import {
  computePublishPath,
  shouldAutoLinkParent,
  validatePublishPath,
} from '../publish-utils'

function createDocument(content: HMBlockNode[]): HMDocument {
  return {
    id: 'test-doc-id',
    account: 'test-account',
    path: ['test', 'path'],
    version: 'v1',
    authors: [],
    content,
    metadata: {},
    visibility: 'PUBLIC',
    createTime: new Date(),
    updateTime: new Date(),
    genesis: 'genesis-id',
  } as unknown as HMDocument
}

describe('computePublishPath', () => {
  it('private docs use basePath as-is without appending doc name', () => {
    const basePath = ['-TWLswGF5TvO9tCnnkwOG']
    const result = computePublishPath(true, basePath, 'My Private Document')
    expect(result).toEqual(['-TWLswGF5TvO9tCnnkwOG'])
  })

  it('private docs preserve the random ID even with empty doc name', () => {
    const basePath = ['-XyzAbc123']
    const result = computePublishPath(true, basePath, '')
    expect(result).toEqual(['-XyzAbc123'])
  })

  it('public docs append pathNameified doc name to basePath', () => {
    const basePath = ['parent']
    const result = computePublishPath(false, basePath, 'My Document Title')
    expect(result).toEqual(['parent', 'my-document-title'])
  })

  it('public docs with empty basePath create single-segment path', () => {
    const result = computePublishPath(false, [], 'Hello World')
    expect(result).toEqual(['hello-world'])
  })

  it('public docs use "untitled-document" for empty name', () => {
    const result = computePublishPath(false, [], '')
    expect(result).toEqual(['untitled-document'])
  })
})

describe('validatePublishPath', () => {
  // Mimics the real validatePath behavior for testing
  const mockValidatePath = (path: string) => {
    if (path === '') return null
    if (!path.startsWith('/'))
      return {error: "wrong path format (should start with '/')"}
    const p = path.slice(1)
    if (['assets', 'favicon.ico', 'robots.txt', 'hm', 'api'].includes(p)) {
      return {error: `This path name is reserved and can't be used: ${p}`}
    }
    if (p.startsWith('-') || p.startsWith('.') || p.startsWith('_')) {
      return {
        error: `Path can't start with special characters "-", "." or "_": ${p}`,
      }
    }
    return null
  }

  it('private docs always pass validation', () => {
    // Path starting with "-" would normally fail validatePath
    const result = validatePublishPath(
      true,
      ['-TWLswGF5TvO9tCnnkwOG'],
      mockValidatePath,
    )
    expect(result).toBeNull()
  })

  it('private docs skip validation — validatePathFn is never called', () => {
    const spy = vi.fn()
    const result = validatePublishPath(true, ['_hidden', '.secret'], spy)
    expect(result).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('public docs with valid path pass validation', () => {
    const result = validatePublishPath(false, ['valid-path'], mockValidatePath)
    expect(result).toBeNull()
  })

  it('public docs with path starting with "-" fail validation', () => {
    const result = validatePublishPath(false, ['-invalid'], mockValidatePath)
    expect(result).not.toBeNull()
    expect(result).toContain("can't start with special characters")
  })

  it('public docs with reserved path fail validation', () => {
    const result = validatePublishPath(false, ['assets'], mockValidatePath)
    expect(result).not.toBeNull()
    expect(result).toContain('reserved')
  })
})

describe('shouldAutoLinkParent', () => {
  const parentId = hmId('parent-uid', {path: ['parent']})

  it('private docs never auto-link to parent', () => {
    const editableLocation = hmId('parent-uid', {path: ['parent', 'child']})
    const parentDoc = createDocument([])
    const result = shouldAutoLinkParent(
      true,
      parentDoc,
      editableLocation,
      parentId,
    )
    expect(result).toBe(false)
  })

  it('private docs skip auto-link even when parent has no existing links', () => {
    const editableLocation = hmId('parent-uid', {path: ['parent', 'child']})
    const result = shouldAutoLinkParent(true, null, editableLocation, parentId)
    expect(result).toBe(false)
  })

  it('public docs auto-link when parent has no existing link', () => {
    const editableLocation = hmId('parent-uid', {path: ['parent', 'child']})
    const parentDoc = createDocument([])
    const result = shouldAutoLinkParent(
      false,
      parentDoc,
      editableLocation,
      parentId,
    )
    expect(result).toBe(true)
  })

  it('public docs skip auto-link when parent already contains link to child', () => {
    const editableLocation = hmId('parent-uid', {path: ['parent', 'child']})
    const parentDoc = createDocument([
      {
        block: {
          id: 'e1',
          type: 'Embed',
          link: 'hm://parent-uid/parent/child',
          attributes: {view: 'Card'},
        },
      },
    ] as HMBlockNode[])
    const result = shouldAutoLinkParent(
      false,
      parentDoc,
      editableLocation,
      parentId,
    )
    expect(result).toBe(false)
  })

  it('public docs skip auto-link when parent has self-query', () => {
    const editableLocation = hmId('parent-uid', {path: ['parent', 'child']})
    const parentDoc = createDocument([
      {
        block: {
          id: 'q1',
          type: 'Query',
          attributes: {
            style: 'Card',
            banner: false,
            columnCount: 1,
            query: {
              includes: [
                {space: 'parent-uid', path: '/parent', mode: 'Children'},
              ],
            },
          },
        },
      },
    ] as HMBlockNode[])
    const result = shouldAutoLinkParent(
      false,
      parentDoc,
      editableLocation,
      parentId,
    )
    expect(result).toBe(false)
  })

  it('public docs auto-link when no parent document exists yet', () => {
    const editableLocation = hmId('parent-uid', {path: ['parent', 'child']})
    const result = shouldAutoLinkParent(false, null, editableLocation, parentId)
    expect(result).toBe(true)
  })
})
