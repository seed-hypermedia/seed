import {describe, expect, it} from 'vitest'
import {
  extractInspectIpfsPathFromPath,
  extractInspectPrefixFromPath,
  extractViewTermFromPath,
  getDocumentRouteLoaderDeps,
  shouldReloadDocumentRouteData,
} from './document-route-path'

describe('document route path helpers', () => {
  it('extracts document view suffixes without changing the document path', () => {
    expect(extractViewTermFromPath(['docs', ':activity', 'changes'])).toEqual({
      path: ['docs'],
      viewTerm: 'activity',
      activityFilter: 'changes',
    })
    expect(extractViewTermFromPath(['docs', ':comments', 'comment123'])).toEqual({
      path: ['docs'],
      viewTerm: 'comments',
      commentId: 'comment123',
    })
    expect(extractViewTermFromPath(['docs', ':comments', 'uid', 'tsid'])).toEqual({
      path: ['docs'],
      viewTerm: 'comments',
      commentId: 'uid/tsid',
    })
    expect(extractViewTermFromPath(['docs', ':comment', 'legacy'])).toEqual({
      path: ['docs'],
      viewTerm: 'comments',
      commentId: 'legacy',
    })
    expect(extractViewTermFromPath(['docs', ':discussions', 'legacy'])).toEqual({
      path: ['docs'],
      viewTerm: 'comments',
      commentId: 'legacy',
    })
    expect(extractViewTermFromPath(['docs', ':followers', 'alice'])).toEqual({
      path: ['docs'],
      viewTerm: 'followers',
      accountUid: 'alice',
    })
  })

  it('extracts inspect prefixes from site and gateway paths', () => {
    expect(extractInspectPrefixFromPath(['inspect', 'docs'], false)).toEqual({pathParts: ['docs'], isInspect: true})
    expect(extractInspectPrefixFromPath(['hm', 'inspect', 'alice', 'docs'], true)).toEqual({
      pathParts: ['alice', 'docs'],
      isInspect: true,
    })
    expect(extractInspectPrefixFromPath(['hm', 'alice', 'docs'], true)).toEqual({
      pathParts: ['alice', 'docs'],
      isInspect: false,
    })
  })

  it('extracts inspect ipfs paths from site and gateway paths', () => {
    expect(extractInspectIpfsPathFromPath(['inspect', 'ipfs', 'bafy', 'file.png'], false)).toBe('bafy/file.png')
    expect(extractInspectIpfsPathFromPath(['hm', 'inspect', 'ipfs', 'bafy'], true)).toBe('bafy')
    expect(extractInspectIpfsPathFromPath(['hm', 'alice'], true)).toBeNull()
  })

  it('keeps cosmetic search params out of document loader dependencies', () => {
    const first = new URL('https://seed.test/docs?v=version1&panel=comments')
    const second = new URL('https://seed.test/docs?v=version1&panel=activity')
    const changedVersion = new URL('https://seed.test/docs?v=version2&panel=comments')
    const implicitLatest = new URL('https://seed.test/docs')
    const explicitLatest = new URL('https://seed.test/docs?l')
    const nonEmptyLatestParam = new URL('https://seed.test/docs?l=true')
    const versionWithLatestParam = new URL('https://seed.test/docs?v=version1&l')
    const differentPath = new URL('https://seed.test/other?v=version1')

    expect(getDocumentRouteLoaderDeps(first)).toEqual({pathname: '/docs', version: 'version1', latest: false})
    expect(getDocumentRouteLoaderDeps(explicitLatest)).toEqual({pathname: '/docs', version: null, latest: true})
    expect(getDocumentRouteLoaderDeps(nonEmptyLatestParam)).toEqual({pathname: '/docs', version: null, latest: true})
    expect(shouldReloadDocumentRouteData(first, second, true)).toBe(false)
    expect(shouldReloadDocumentRouteData(first, changedVersion, true)).toBe(true)
    expect(shouldReloadDocumentRouteData(implicitLatest, explicitLatest, true)).toBe(false)
    expect(shouldReloadDocumentRouteData(first, versionWithLatestParam, true)).toBe(true)
    expect(shouldReloadDocumentRouteData(first, differentPath, false)).toBe(false)
  })
})
