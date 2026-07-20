import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

describe('WebResourcePage restore action wiring', () => {
  it('only exposes the restore action when the web user can edit', () => {
    const source = readFileSync(join(__dirname, 'web-resource-page.tsx'), 'utf8')

    expect(source).toContain(
      'onRestoreDocumentVersion={effectiveCanEdit && signingAccountId ? onRestoreDocumentVersion : undefined}',
    )
  })

  it('opens the move dialog with draft context for unpublished draft routes', () => {
    const source = readFileSync(join(__dirname, 'web-resource-page.tsx'), 'utf8')

    expect(source).toContain('const draftMoveId = draftData?.draftId || placeholderDraftId')
    expect(source).toContain('draft: {')
    expect(source).toContain('draftId: draftMoveId')
  })

  it('provides a query block document search input on web', () => {
    const source = readFileSync(join(__dirname, 'web-resource-page.tsx'), 'utf8')

    expect(source).toContain("import {QuerySearchInputProvider} from '@shm/editor/query-search-context'")
    expect(source).toContain("import {WebQuerySearchInput} from './web-query-search-input'")
    expect(source).toContain('<QuerySearchInputProvider value={WebQuerySearchInput}>')
    expect(source).toContain('</QuerySearchInputProvider>')
  })
})
