import {describe, expect, it} from 'vitest'
import {editorBlockToHMBlock} from './editorblock-to-hmblock'
import {hmBlocksToEditorContent} from './hmblock-to-editorblock'
import {InlineEmbedAnnotationSchema} from './hm-types'
import type {EditorBlock} from './editor-types'

describe('mention reference contract', () => {
  it('preserves explicit kinds and does not merge them with legacy references', () => {
    const content = [undefined, 'account', 'document'].map((mentionKind) => ({
      type: 'inline-embed',
      link: 'hm://alice',
      styles: {},
      ...(mentionKind ? {mentionKind} : {}),
    }))
    const block = editorBlockToHMBlock({id: 'p', type: 'paragraph', props: {}, children: [], content} as EditorBlock)
    expect((block as any).annotations.map((a: any) => a.attributes)).toEqual([
      {},
      {mentionKind: 'account'},
      {mentionKind: 'document'},
    ])
    expect(hmBlocksToEditorContent([{block, children: []}])[0]?.content).toEqual(content)
  })
  it('accepts mention metadata without changing legacy annotations', () => {
    const legacy = {type: 'Embed', link: 'hm://alice', starts: [0], ends: [1]}
    expect(InlineEmbedAnnotationSchema.parse(legacy)).toEqual(legacy)
    expect(InlineEmbedAnnotationSchema.parse({...legacy, attributes: {mentionKind: 'document'}}).attributes).toEqual({
      mentionKind: 'document',
    })
  })
})

it('does not collide with a legacy URL ending in a mention-kind suffix', () => {
  const block = editorBlockToHMBlock({
    id: 'p',
    type: 'paragraph',
    props: {},
    children: [],
    content: [
      {type: 'inline-embed', link: 'hm://alice/foo-document', styles: {}},
      {type: 'inline-embed', link: 'hm://alice/foo', mentionKind: 'document', styles: {}},
    ],
  })
  expect((block as any).annotations).toHaveLength(2)
})
