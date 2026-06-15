import {describe, expect, it} from 'vitest'
import {HMHeadingBlockContent} from '../../../../../heading-component-plugin'
import {HeadingBlockContent} from '../nodes/BlockContent/HeadingBlockContent/HeadingBlockContent'
import {ParagraphBlockContent} from '../nodes/BlockContent/ParagraphBlockContent/ParagraphBlockContent'

describe('default block revision attributes', () => {
  it('preserves revision on paragraph and default heading content nodes', () => {
    expect((ParagraphBlockContent as any).config.addAttributes?.().revision?.default).toBe('')
    expect((HeadingBlockContent as any).config.addAttributes?.().revision?.default).toBe('')
  })

  it('preserves revision on the document editor heading content node', () => {
    expect((HMHeadingBlockContent as any).config.addAttributes?.().revision?.default).toBe('')
  })
})
