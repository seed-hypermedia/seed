import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {getBlockFragment} from '../blocks-content-utils'

const node: HMBlockNode = {
  block: {
    id: 'source',
    type: 'Paragraph',
    text: 'Before 😀bold after',
    attributes: {},
    annotations: [
      {type: 'Bold', starts: [0, 8], ends: [3, 17]},
      {type: 'Italic', starts: [6], ends: [10]},
      {type: 'Link', starts: [8], ends: [12], link: 'https://example.com'},
      {type: 'Underline', starts: [0], ends: [7]},
    ],
  },
  children: [{block: {id: 'child', type: 'Paragraph', text: 'Child', attributes: {}, annotations: []}}],
}

describe('getBlockFragment', () => {
  it('slices by codepoint and clips and rebases annotation ranges without changing the source', () => {
    const original = structuredClone(node)
    const result = getBlockFragment(node, {start: 7, end: 12})
    expect(result?.block).toMatchObject({
      text: '😀bold',
      annotations: [
        {type: 'Bold', starts: [1], ends: [5]},
        {type: 'Italic', starts: [0], ends: [3]},
        {type: 'Link', starts: [1], ends: [5], link: 'https://example.com'},
      ],
    })
    expect(result?.children).toEqual([])
    expect(node).toEqual(original)
  })

  it('supports a fragment at either edge of a block', () => {
    expect(getBlockFragment(node, {start: 0, end: 6})?.block).toMatchObject({text: 'Before'})
    expect(getBlockFragment(node, {start: 13, end: 18})?.block).toMatchObject({text: 'after'})
  })

  it.each([
    {start: -1, end: 2},
    {start: 3, end: 3},
    {start: 5, end: 2},
    {start: 0, end: 99},
    {start: 0.5, end: 3},
    {expanded: true},
    null,
  ])('leaves invalid or non-text ranges in the full-block view: %j', (range) => {
    expect(getBlockFragment(node, range)).toBeNull()
  })

  it('does not crop media captions as if they were text blocks', () => {
    expect(
      getBlockFragment(
        {block: {id: 'image', type: 'Image', text: 'Caption', link: 'ipfs://image', attributes: {}, annotations: []}},
        {start: 0, end: 3},
      ),
    ).toBeNull()
  })
})
