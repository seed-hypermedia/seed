import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {getDocumentSelectionObserverKey} from './document-editor'

describe('getDocumentSelectionObserverKey', () => {
  it('returns a key for collapsed selections', () => {
    expect(getDocumentSelectionObserverKey({from: 12, to: 12})).toBe('12:12')
  })

  it('returns a key for range selections', () => {
    expect(getDocumentSelectionObserverKey({from: 12, to: 18})).toBe('12:18')
  })
})

describe('outside pointer editing behavior', () => {
  it('does not install a document-level pointerdown listener that exits edit mode', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/document-editor.tsx'), 'utf8')

    expect(source).not.toContain("document.addEventListener('pointerdown'")
    expect(source).not.toContain('document.addEventListener("pointerdown"')
  })
})
