import {HMBlockNode, HMDocument} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {describe, expect, it, vi} from 'vitest'
import {
  computeInlineDraftPublishPath,
  computeNewDraftParams,
  computePublishPath,
  resolvePublishPath,
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
    if (!path.startsWith('/')) return {error: "wrong path format (should start with '/')"}
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
    const result = validatePublishPath(true, ['-TWLswGF5TvO9tCnnkwOG'], mockValidatePath)
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
    const result = shouldAutoLinkParent(true, parentDoc, editableLocation, parentId)
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
    const result = shouldAutoLinkParent(false, parentDoc, editableLocation, parentId)
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
    const result = shouldAutoLinkParent(false, parentDoc, editableLocation, parentId)
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
              includes: [{space: 'parent-uid', path: '/parent', mode: 'Children'}],
            },
          },
        },
      },
    ] as HMBlockNode[])
    const result = shouldAutoLinkParent(false, parentDoc, editableLocation, parentId)
    expect(result).toBe(false)
  })

  it('public docs auto-link when no parent document exists yet', () => {
    const editableLocation = hmId('parent-uid', {path: ['parent', 'child']})
    const result = shouldAutoLinkParent(false, null, editableLocation, parentId)
    expect(result).toBe(true)
  })
})

describe('computeInlineDraftPublishPath', () => {
  it('replaces the trailing -${draftId} segment with the title slug', () => {
    const editPath = ['parent', '-zrBTq6Tr6d']
    const result = computeInlineDraftPublishPath(editPath, 'My Cool Doc', 'zrBTq6Tr6d')
    expect(result).toEqual(['parent', 'my-cool-doc'])
  })

  it('falls back to untitled-${draftId} when title is empty', () => {
    const editPath = ['parent', '-zrBTq6Tr6d']
    const result = computeInlineDraftPublishPath(editPath, '', 'zrBTq6Tr6d')
    expect(result).toEqual(['parent', 'untitled-zrBTq6Tr6d'])
  })

  it('falls back to untitled-${draftId} when title slugifies to empty', () => {
    // Title made of only punctuation that pathNameify strips entirely
    const editPath = ['parent', '-abc']
    const result = computeInlineDraftPublishPath(editPath, '!@#$%', 'abc')
    expect(result).toEqual(['parent', 'untitled-abc'])
  })

  it('preserves multi-segment parent paths', () => {
    const editPath = ['a', 'b', 'c', '-xyz']
    const result = computeInlineDraftPublishPath(editPath, 'Hello World', 'xyz')
    expect(result).toEqual(['a', 'b', 'c', 'hello-world'])
  })

  it('handles a top-level draft (only draftId segment)', () => {
    const editPath = ['-onlySeg']
    const result = computeInlineDraftPublishPath(editPath, 'Top Level', 'onlySeg')
    expect(result).toEqual(['top-level'])
  })

  it('produces collision-free fallbacks for two untitled drafts at the same parent', () => {
    const a = computeInlineDraftPublishPath(['parent', '-aaa'], '', 'aaa')
    const b = computeInlineDraftPublishPath(['parent', '-bbb'], '', 'bbb')
    expect(a).not.toEqual(b)
  })

  it('preserves empty path for home-document edits regardless of title or draftId', () => {
    expect(computeInlineDraftPublishPath([], 'Home Title', 'abc')).toEqual([])
    expect(computeInlineDraftPublishPath([], '', 'abc')).toEqual([])
    expect(computeInlineDraftPublishPath([], '!@#$', 'abc')).toEqual([])
  })

  it('strips leading/trailing space-derived dashes from the slug', () => {
    const editPath = ['parent', '-abc']
    expect(computeInlineDraftPublishPath(editPath, ' hello world ', 'abc')).toEqual(['parent', 'hello-world'])
  })

  it('strips leading/trailing literal `-`, `_`, `.` from the slug', () => {
    const editPath = ['parent', '-abc']
    expect(computeInlineDraftPublishPath(editPath, '-hello-', 'abc')).toEqual(['parent', 'hello'])
    expect(computeInlineDraftPublishPath(editPath, '_hello_', 'abc')).toEqual(['parent', 'hello'])
    expect(computeInlineDraftPublishPath(editPath, '.hello.', 'abc')).toEqual(['parent', 'hello'])
  })

  it('falls back to untitled-${draftId} when title is only special chars', () => {
    const editPath = ['parent', '-abc']
    expect(computeInlineDraftPublishPath(editPath, '---', 'abc')).toEqual(['parent', 'untitled-abc'])
    expect(computeInlineDraftPublishPath(editPath, '___', 'abc')).toEqual(['parent', 'untitled-abc'])
    expect(computeInlineDraftPublishPath(editPath, '...', 'abc')).toEqual(['parent', 'untitled-abc'])
  })
})

describe('resolvePublishPath', () => {
  const baseArgs = {
    draftId: 'abc',
    draftName: 'My Cool Doc',
    isPrivate: false,
    existsAtDestination: false,
    pathOverride: undefined as string[] | undefined,
  }

  it('renames the placeholder `-${draftId}` to the title slug on first publish', () => {
    expect(
      resolvePublishPath({
        ...baseArgs,
        currentPath: ['parent', '-abc'],
      }),
    ).toEqual(['parent', 'my-cool-doc'])
  })

  it('falls back to `untitled-${draftId}` when title is empty', () => {
    expect(
      resolvePublishPath({
        ...baseArgs,
        draftName: '',
        currentPath: ['parent', '-abc'],
      }),
    ).toEqual(['parent', 'untitled-abc'])
  })

  it('honours pathOverride over the auto-derived slug', () => {
    expect(
      resolvePublishPath({
        ...baseArgs,
        currentPath: ['parent', '-abc'],
        pathOverride: ['parent', 'foo-bar'],
      }),
    ).toEqual(['parent', 'foo-bar'])
  })

  it('ignores pathOverride for private drafts', () => {
    expect(
      resolvePublishPath({
        ...baseArgs,
        currentPath: ['-randomid'],
        isPrivate: true,
        pathOverride: ['public', 'slug'],
      }),
    ).toEqual(['-randomid'])
  })

  it('skips the rename for private drafts', () => {
    expect(
      resolvePublishPath({
        ...baseArgs,
        isPrivate: true,
        currentPath: ['-abc'],
      }),
    ).toEqual(['-abc'])
  })

  it('skips the rename for home-doc edits (empty path)', () => {
    expect(
      resolvePublishPath({
        ...baseArgs,
        currentPath: [],
      }),
    ).toEqual([])
  })

  it('skips the rename when the doc already exists at the destination', () => {
    expect(
      resolvePublishPath({
        ...baseArgs,
        currentPath: ['parent', '-abc'],
        existsAtDestination: true,
      }),
    ).toEqual(['parent', '-abc'])
  })

  it('leaves non-placeholder paths untouched (already renamed by the user)', () => {
    expect(
      resolvePublishPath({
        ...baseArgs,
        currentPath: ['parent', 'already-named'],
      }),
    ).toEqual(['parent', 'already-named'])
  })

  it('leaves a placeholder for a different draftId untouched', () => {
    expect(
      resolvePublishPath({
        ...baseArgs,
        currentPath: ['parent', '-otherDraftId'],
      }),
    ).toEqual(['parent', '-otherDraftId'])
  })

  it('renames a top-level placeholder draft', () => {
    expect(
      resolvePublishPath({
        ...baseArgs,
        currentPath: ['-abc'],
      }),
    ).toEqual(['my-cool-doc'])
  })
})

describe('computeNewDraftParams', () => {
  const mockGenerateId = () => 'draft-id-10'
  const mockGeneratePath = () => 'random-path-21'

  it('private doc uses draftParams.locationUid, not selectedAccountId', () => {
    const result = computeNewDraftParams(
      'PRIVATE',
      {locationUid: 'location-uid', locationPath: ['docs']},
      'selected-account-uid',
      mockGenerateId,
      mockGeneratePath,
    )
    expect(result?.draftId).toBe('draft-id-10')
    expect(result?.writeParams).toEqual({
      id: 'draft-id-10',
      locationUid: 'location-uid',
      locationPath: ['-private-draft-id-10'],
      editUid: 'location-uid',
      editPath: ['-private-draft-id-10'],
      visibility: 'PRIVATE',
    })
    expect(result?.routeId.uid).toBe('location-uid')
    expect(result?.routeId.path).toEqual(['-private-draft-id-10'])
  })

  it('private doc falls back to selectedAccountId when no locationUid', () => {
    const result = computeNewDraftParams('PRIVATE', {}, 'selected-account-uid', mockGenerateId, mockGeneratePath)
    expect(result?.writeParams.locationUid).toBe('selected-account-uid')
    expect(result?.writeParams.editUid).toBe('selected-account-uid')
    expect(result?.writeParams.locationPath).toEqual(['-private-draft-id-10'])
    expect(result?.routeId.uid).toBe('selected-account-uid')
  })

  it('private doc returns null when no locationUid and no selectedAccountId', () => {
    const result = computeNewDraftParams('PRIVATE', {}, undefined, mockGenerateId, mockGeneratePath)
    expect(result).toBeNull()
  })

  it('private doc ignores draftParams.locationPath and uses the draft placeholder path', () => {
    const result = computeNewDraftParams(
      'PRIVATE',
      {locationUid: 'location-uid', locationPath: ['existing', 'path']},
      'selected-account-uid',
      mockGenerateId,
      mockGeneratePath,
    )
    expect(result?.writeParams.locationPath).toEqual(['-private-draft-id-10'])
  })

  it('public new doc stores a location-only draft and routes to the draft placeholder path', () => {
    const draftParams = {
      locationUid: 'location-uid',
      locationPath: ['docs', 'sub'],
    }
    const result = computeNewDraftParams(
      'PUBLIC',
      draftParams,
      'selected-account-uid',
      mockGenerateId,
      mockGeneratePath,
    )
    expect(result?.writeParams).toEqual({
      id: 'draft-id-10',
      locationUid: 'location-uid',
      locationPath: ['docs', 'sub'],
      deps: undefined,
      visibility: 'PUBLIC',
    })
    expect(result?.routeId.uid).toBe('location-uid')
    expect(result?.routeId.path).toEqual(['docs', 'sub', '-draft-id-10'])
  })

  it('editing existing doc uses editUid/editPath and preserves deps', () => {
    const draftParams = {
      editUid: 'edit-uid',
      editPath: ['existing', 'doc'],
      deps: ['v1'],
    }
    const result = computeNewDraftParams(
      undefined,
      draftParams,
      'selected-account-uid',
      mockGenerateId,
      mockGeneratePath,
    )
    expect(result?.writeParams).toEqual({
      id: 'draft-id-10',
      editUid: 'edit-uid',
      editPath: ['existing', 'doc'],
      deps: ['v1'],
      visibility: 'PUBLIC',
    })
    expect(result?.routeId.uid).toBe('edit-uid')
    expect(result?.routeId.path).toEqual(['existing', 'doc'])
  })

  it('returns null when no edit anchor and no location', () => {
    const result = computeNewDraftParams(undefined, {}, undefined, mockGenerateId, mockGeneratePath)
    expect(result).toBeNull()
  })
})
