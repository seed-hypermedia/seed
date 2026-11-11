// @vitest-environment jsdom
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {beforeEach, expect, it} from 'vitest'
import {
  injectMediaRefs,
  getDraftKey,
  listWebCommentDrafts,
  loadWebCommentDraft,
  removeWebCommentDraft,
  saveWebCommentDraft,
} from './comment-draft-utils'

const blocks: HMBlockNode[] = [{block: {id: 'text', type: 'Paragraph', text: 'Unsent reply', attributes: {}}}]
const emptyBlocks: HMBlockNode[] = [{block: {id: 'text', type: 'Paragraph', text: '', attributes: {}}}]
const mediaRefs = {image: '{"url":"blob:upload"}'}
const target = {docId: 'hm://doc', replyCommentId: 'parent'}

beforeEach(() => {
  localStorage.clear()
})

it('round-trips a draft through save and load', () => {
  const key = getDraftKey('hm://doc', 'parent')
  saveWebCommentDraft(key, target, {blocks, mediaRefs})
  const loaded = loadWebCommentDraft(key)
  expect(loaded?.blocks).toEqual(blocks)
  expect(loaded?.mediaRefs).toEqual(mediaRefs)
})

it('re-injects stored mediaRefs into block attributes on load', () => {
  const key = getDraftKey('hm://doc', 'parent')
  const withImage: HMBlockNode[] = [
    {block: {id: 'image', type: 'Image', link: 'ipfs://x', attributes: {}}, children: []} as unknown as HMBlockNode,
  ]
  saveWebCommentDraft(key, target, {blocks: withImage, mediaRefs: {image: '{"url":"blob:upload"}'}})
  const loaded = loadWebCommentDraft(key)
  expect((loaded?.blocks[0]?.block as any).attributes.mediaRef).toEqual({url: 'blob:upload'})
  expect(loaded?.mediaRefs).toEqual({image: '{"url":"blob:upload"}'})
})

it('returns null when no draft is stored', () => {
  expect(loadWebCommentDraft(getDraftKey('hm://doc', 'parent'))).toBeNull()
})

it('removes the stored draft instead of saving empty content', () => {
  const key = getDraftKey('hm://doc', 'parent')
  saveWebCommentDraft(key, target, {blocks})
  saveWebCommentDraft(key, target, {blocks: emptyBlocks})
  expect(localStorage.getItem(key)).toBeNull()
  expect(loadWebCommentDraft(key)).toBeNull()
})

it('removes a stored draft', () => {
  const key = getDraftKey('hm://doc', 'parent')
  saveWebCommentDraft(key, target, {blocks})
  removeWebCommentDraft(key)
  expect(localStorage.getItem(key)).toBeNull()
})

it('saves explicit targets so the Drafts page can resume a local reply', () => {
  const key = getDraftKey('hm://doc', 'parent')
  saveWebCommentDraft(key, target, {blocks, mediaRefs})
  expect(listWebCommentDrafts()).toMatchObject([{docId: 'hm://doc', replyCommentId: 'parent', blocks, mediaRefs}])
})

it('injectMediaRefs maps serialized mediaRefs back onto block attributes', () => {
  const blocks = [
    {block: {id: 'image', type: 'Image', link: 'ipfs://x', attributes: {}}, children: []},
    {block: {id: 'text', type: 'Paragraph', text: 'hello', attributes: {}}, children: []},
  ] as unknown as HMBlockNode[]
  const injected = injectMediaRefs({blocks, mediaRefs: {image: '{"url":"blob:upload"}'}})
  expect((injected[0]!.block as any).attributes.mediaRef).toEqual({url: 'blob:upload'})
  expect((injected[1]!.block as any).attributes.mediaRef).toBeUndefined()
  expect(injectMediaRefs({blocks})).toBe(blocks)
})
