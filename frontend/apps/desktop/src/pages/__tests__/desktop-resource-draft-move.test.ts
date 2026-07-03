import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

describe('DesktopResourcePage draft move action wiring', () => {
  it('opens the move dialog with draft context for unpublished draft routes', () => {
    const source = readFileSync(join(__dirname, '../desktop-resource.tsx'), 'utf8')

    expect(source).toContain('const draftMoveId = currentDraftId || placeholderDraftId')
    expect(source).toContain('draft: {draftId: draftMoveId')
    expect(source).toContain('parentDocumentId: fallbackParent')
  })
})
