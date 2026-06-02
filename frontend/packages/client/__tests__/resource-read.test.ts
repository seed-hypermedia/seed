import {describe, expect, it} from 'vitest'
import {resolveIdWithClient} from '../src/resource-read'

function packedResolvedId(result: Awaited<ReturnType<typeof resolveIdWithClient>>) {
  const path = result.id.path?.length ? `/${result.id.path.join('/')}` : ''
  return `hm://${result.id.uid}${path}`
}

describe('resolveIdWithClient', () => {
  it('resolves canonical hm comment URLs directly', async () => {
    const result = await resolveIdWithClient('hm://comment-author/comment-tsid')

    expect(packedResolvedId(result)).toBe('hm://comment-author/comment-tsid')
    expect(result.serverUrl).toBe('https://hyper.media')
  })

  it('resolves gateway hm comment URLs directly', async () => {
    const result = await resolveIdWithClient('https://site.example/hm/comment-author/comment-tsid')

    expect(packedResolvedId(result)).toBe('hm://comment-author/comment-tsid')
    expect(result.serverUrl).toBe('https://site.example')
  })

  it('resolves hm comment view URLs to the linked comment resource', async () => {
    const result = await resolveIdWithClient('hm://doc-author/doc/:comments/comment-author/comment-tsid')

    expect(packedResolvedId(result)).toBe('hm://comment-author/comment-tsid')
    expect(result.serverUrl).toBe('https://hyper.media')
  })

  it('resolves web comment view URLs without treating :comments as a document path', async () => {
    const result = await resolveIdWithClient('https://site.example/doc/:comments/comment-author/comment-tsid')

    expect(packedResolvedId(result)).toBe('hm://comment-author/comment-tsid')
    expect(result.serverUrl).toBe('https://site.example')
  })

  it('resolves panel comment URLs to the selected comment resource', async () => {
    const result = await resolveIdWithClient('https://site.example/doc?panel=comments/comment-author/comment-tsid')

    expect(packedResolvedId(result)).toBe('hm://comment-author/comment-tsid')
    expect(result.serverUrl).toBe('https://site.example')
  })

  it('passes domain resolver options through for non-comment web URLs', async () => {
    const result = await resolveIdWithClient('https://site.example/doc', {
      domainResolver: async (hostname) => (hostname === 'site.example' ? 'site-account' : null),
    })

    expect(packedResolvedId(result)).toBe('hm://site-account/doc')
    expect(result.serverUrl).toBe('https://site.example')
  })
})
