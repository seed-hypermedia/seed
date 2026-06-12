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
})
