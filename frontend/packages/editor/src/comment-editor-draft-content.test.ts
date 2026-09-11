import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {blocksHaveDraftContent} from './comment-editor-draft-content'

function paragraph(text: string): HMBlockNode {
  return {block: {id: 'p', type: 'Paragraph', text, attributes: {}, annotations: []}}
}

describe('blocksHaveDraftContent', () => {
  it('is empty for no blocks or whitespace-only paragraphs', () => {
    expect(blocksHaveDraftContent(undefined)).toBe(false)
    expect(blocksHaveDraftContent([])).toBe(false)
    expect(blocksHaveDraftContent([paragraph('   ')])).toBe(false)
  })

  it('counts text and children', () => {
    expect(blocksHaveDraftContent([paragraph('hello')])).toBe(true)
    expect(blocksHaveDraftContent([{...paragraph(''), children: [paragraph('child')]}])).toBe(true)
  })

  it('counts an embed-only draft as content', () => {
    // Regression: the default agent system prompt is a single Embed block with no text, and the
    // editor collapsed it to the "Start a Discussion" placeholder as if the draft were empty.
    const embed: HMBlockNode = {
      block: {
        id: 'e',
        type: 'Embed',
        text: '',
        link: 'hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/skill',
        attributes: {childrenType: 'Group', view: 'Content'},
        annotations: [],
      },
    }
    expect(blocksHaveDraftContent([embed])).toBe(true)
  })

  it('counts non-text blocks such as queries and images', () => {
    const query = {block: {id: 'q', type: 'Query', attributes: {}}} as unknown as HMBlockNode
    const image = {
      block: {id: 'i', type: 'Image', text: '', link: 'ipfs://abc', attributes: {}},
    } as unknown as HMBlockNode
    expect(blocksHaveDraftContent([query])).toBe(true)
    expect(blocksHaveDraftContent([image])).toBe(true)
  })
})
