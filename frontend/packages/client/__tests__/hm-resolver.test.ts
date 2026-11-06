import {describe, expect, it} from 'vitest'
import {extractCommentIdFromUrl} from '../src/hm-resolver'

describe('extractCommentIdFromUrl', () => {
  it('returns the selected reply when a site URL carries panel and reply', () => {
    const url =
      'https://site.example/tasks/something?panel=comments/z6Mkrootuid/z6FCroottsid&reply=z6Mkreplyuid/z6FCreplytsid'
    expect(extractCommentIdFromUrl(url)).toBe('z6Mkreplyuid/z6FCreplytsid')
  })

  it('returns the panel comment when a site URL carries only panel', () => {
    const url = 'https://site.example/tasks/something?panel=comments/z6Mkrootuid/z6FCroottsid'
    expect(extractCommentIdFromUrl(url)).toBe('z6Mkrootuid/z6FCroottsid')
  })

  it('returns null when only a reply is present without a comment thread', () => {
    const url = 'https://site.example/tasks/something?reply=z6Mkreplyuid/z6FCreplytsid'
    expect(extractCommentIdFromUrl(url)).toBeNull()
  })

  it('returns null for a single-segment panel param (block discussion)', () => {
    const url = 'https://site.example/tasks/something?panel=comments/block-id'
    expect(extractCommentIdFromUrl(url)).toBeNull()
  })

  it('returns null for a bare panel=comments', () => {
    const url = 'https://site.example/tasks/something?panel=comments'
    expect(extractCommentIdFromUrl(url)).toBeNull()
  })

  it('returns null for a bare panel=comment', () => {
    const url = 'https://site.example/tasks/something?panel=comment'
    expect(extractCommentIdFromUrl(url)).toBeNull()
  })

  it('resolves the /:comments/<uid>/<tsid> path form on a site URL', () => {
    const url = 'https://site.example/doc/:comments/z6Mkauthor/z6FCtsid'
    expect(extractCommentIdFromUrl(url)).toBe('z6Mkauthor/z6FCtsid')
  })

  it('resolves the /:comments/<uid>/<tsid> path form on an hm:// URL', () => {
    const url = 'hm://site/doc/:comments/z6Mkauthor/z6FCtsid'
    expect(extractCommentIdFromUrl(url)).toBe('z6Mkauthor/z6FCtsid')
  })

  it('resolves the /:comments/<uid>/<tsid> path form on a gateway /hm/ URL', () => {
    const url = 'https://gateway.example/hm/site/doc/:comments/z6Mkauthor/z6FCtsid'
    expect(extractCommentIdFromUrl(url)).toBe('z6Mkauthor/z6FCtsid')
  })

  it('honors ?reply= on the path form', () => {
    const url = 'hm://site/doc/:comments/z6Mkroot/z6FCroottsid?reply=z6Mkreply/z6FCreplytsid'
    expect(extractCommentIdFromUrl(url)).toBe('z6Mkreply/z6FCreplytsid')
  })

  it('honors ?reply= on the gateway path form', () => {
    const url = 'https://gateway.example/hm/site/doc/:comments/z6Mkroot/z6FCroottsid?reply=z6Mkreply/z6FCreplytsid'
    expect(extractCommentIdFromUrl(url)).toBe('z6Mkreply/z6FCreplytsid')
  })

  it('returns null for a plain document URL', () => {
    const url = 'https://site.example/tasks/something'
    expect(extractCommentIdFromUrl(url)).toBeNull()
  })

  it('returns null for a plain hm:// document URL', () => {
    const url = 'hm://site/tasks/something'
    expect(extractCommentIdFromUrl(url)).toBeNull()
  })

  it('accepts the :comment and :discussions view terms on the path', () => {
    expect(extractCommentIdFromUrl('hm://site/doc/:comment/z6Mkauthor/z6FCtsid')).toBe('z6Mkauthor/z6FCtsid')
    expect(extractCommentIdFromUrl('hm://site/doc/:discussions/z6Mkauthor/z6FCtsid')).toBe('z6Mkauthor/z6FCtsid')
  })

  it('accepts the comment and discussions panel prefixes', () => {
    expect(extractCommentIdFromUrl('https://site.example/doc?panel=comment/z6Mkauthor/z6FCtsid')).toBe(
      'z6Mkauthor/z6FCtsid',
    )
    expect(extractCommentIdFromUrl('https://site.example/doc?panel=discussions/z6Mkauthor/z6FCtsid')).toBe(
      'z6Mkauthor/z6FCtsid',
    )
  })

  it('ignores a single-segment reply value', () => {
    const url = 'https://site.example/doc?panel=comments/z6Mkroot/z6FCroottsid&reply=only-one-segment'
    expect(extractCommentIdFromUrl(url)).toBe('z6Mkroot/z6FCroottsid')
  })
})
