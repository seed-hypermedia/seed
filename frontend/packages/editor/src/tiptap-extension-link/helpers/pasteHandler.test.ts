import {describe, expect, it} from 'vitest'
import {restoreBlockRangeSuffix} from './pasteHandler'

describe('restoreBlockRangeSuffix', () => {
  it('reattaches a [start:end] block range linkifyjs truncates', () => {
    const href = 'https://site.example/doc?v=ver#blockId'
    const full = 'https://site.example/doc?v=ver#blockId[20:52]'
    expect(restoreBlockRangeSuffix(href, full)).toBe(full)
  })

  it('reattaches a + expanded block-range marker', () => {
    const href = 'https://site.example/doc#blockId'
    const full = 'https://site.example/doc#blockId+'
    expect(restoreBlockRangeSuffix(href, full)).toBe(full)
  })

  it('is a no-op when href already has the full range', () => {
    const href = 'https://site.example/doc#blockId[20:52]'
    expect(restoreBlockRangeSuffix(href, href)).toBe(href)
  })

  it('does not pull trailing brackets into URLs without a fragment', () => {
    const href = 'https://site.example/doc'
    const full = 'https://site.example/doc[stuff]'
    expect(restoreBlockRangeSuffix(href, full)).toBe(href)
  })

  it('ignores trailing text that is not a block range', () => {
    const href = 'https://site.example/doc#blockId'
    const full = 'https://site.example/doc#blockId rest of paste'
    expect(restoreBlockRangeSuffix(href, full)).toBe(href)
  })

  it('returns href unchanged when fullText does not start with it', () => {
    const href = 'https://site.example/doc#blockId'
    const full = 'see https://site.example/doc#blockId[20:52]'
    expect(restoreBlockRangeSuffix(href, full)).toBe(href)
  })

  it('only consumes the block range, leaving following text untouched', () => {
    const href = 'https://site.example/doc#blockId'
    const full = 'https://site.example/doc#blockId[20:52] (was great!)'
    expect(restoreBlockRangeSuffix(href, full)).toBe('https://site.example/doc#blockId[20:52]')
  })
})
