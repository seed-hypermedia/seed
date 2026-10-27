import {describe, expect, it} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {getContentEmbedHighlight} from '../content-embed'

const source = hmId('alice', {path: ['notes'], blockRef: 'block', blockRange: {start: 10, end: 30}})

describe('embed URL selection', () => {
  it('does not highlight an embed before its source is selected', () => {
    expect(
      getContentEmbedHighlight(source, {key: 'document', id: hmId('alice', {path: ['notes']})}, 'document', false),
    ).toEqual({})
  })
  it('highlights every rendering of the selected resource, but not an unrelated resource', () => {
    const route = {key: 'document' as const, id: source}
    expect(getContentEmbedHighlight(source, route, 'document', false)).toEqual({
      focusBlockId: 'block',
      blockRange: {start: 10, end: 30},
    })
    expect(getContentEmbedHighlight(hmId('bob', {blockRef: 'block'}), route, 'document', false)).toEqual({})
  })
  it('clips source ranges and translates offsets for collapsed fragments', () => {
    const route = {key: 'document' as const, id: {...source, blockRange: {start: 20, end: 40}}}
    expect(getContentEmbedHighlight(source, route, 'document', true)).toEqual({
      focusBlockId: 'block',
      blockRange: {start: 10, end: 20},
    })
    expect(
      getContentEmbedHighlight(source, {...route, id: {...source, blockRange: {start: 30, end: 40}}}, 'document', true),
    ).toEqual({})
  })
  it('highlights full blocks and ignores fragments of a different block', () => {
    const route = {key: 'document' as const, id: {...source, blockRef: 'other', blockRange: null}}
    expect(getContentEmbedHighlight(source, route, 'document', false)).toEqual({focusBlockId: 'other'})
    expect(getContentEmbedHighlight(source, route, 'document', true)).toEqual({})
  })
  it('keeps comment block selections separate from document blocks', () => {
    const route = {
      key: 'comments' as const,
      id: source,
      openComment: 'alice/comment1',
      blockId: 'block',
      blockRange: {start: 2, end: 8},
    }
    expect(getContentEmbedHighlight(source, route, 'document', false)).toEqual({})
    expect(getContentEmbedHighlight(hmId('alice', {path: ['comment1']}), route, 'comment', false)).toEqual({
      focusBlockId: 'block',
      blockRange: {start: 2, end: 8},
    })
  })
})
