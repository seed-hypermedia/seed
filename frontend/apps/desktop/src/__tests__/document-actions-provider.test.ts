import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

describe('DesktopDocumentActionsProvider restore action wiring', () => {
  it('guards restore by the selected account write permission for the target document', () => {
    const source = readFileSync(join(__dirname, '../components/document-actions-provider.tsx'), 'utf8')

    expect(source).toContain('if (!canWriteDocument(id))')
    expect(source).toContain("toast.error('You do not have permission to restore this document')")
    expect(source).toContain(
      '[canWriteDocument, currentRoute, getDraftId, navigate, selectedAccountId, universalClient]',
    )
  })
})
