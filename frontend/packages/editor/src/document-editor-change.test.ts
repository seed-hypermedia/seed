import {describe, expect, it} from 'vitest'
import {getEditorBlocksChange} from './document-editor'

describe('getEditorBlocksChange', () => {
  it('initializes the content snapshot without reporting a real edit', () => {
    const blocks = [{id: 'a', type: 'paragraph', content: []}]
    const result = getEditorBlocksChange(null, blocks)

    expect(result.changed).toBe(false)
    expect(result.nextKey).toBe(JSON.stringify(blocks))
  })

  it('does not report a real edit when selection-only transactions leave blocks unchanged', () => {
    const blocks = [{id: 'a', type: 'paragraph', content: []}]
    const key = JSON.stringify(blocks)

    expect(getEditorBlocksChange(key, blocks)).toEqual({changed: false, nextKey: key})
  })

  it('reports a real edit when block content changes', () => {
    const previous = JSON.stringify([{id: 'a', type: 'paragraph', content: []}])
    const nextBlocks = [{id: 'a', type: 'paragraph', content: [{type: 'text', text: 'Hello', styles: {}}]}]

    expect(getEditorBlocksChange(previous, nextBlocks).changed).toBe(true)
  })
})
