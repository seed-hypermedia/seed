// @vitest-environment jsdom
// Direct, in-context editing from the Attributes editor: the schemaDefinition
// row (and any ipfs OBJECT pill) offers "edit in context" only when the page
// provides it AND the draft hasn't overridden that field.
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {UniversalAppProvider} from '@shm/shared/routing'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DocumentMetadataView} from '../document-metadata-view'
import {schemaCid} from '../onyx/onyx-engine'
import {TooltipProvider} from '../tooltip'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('metadata direct edit', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const stats = schemaCid('example-stats')!
  const mount = (directEdit?: {isFieldEditable: (k: string) => boolean; onEditField: (k: string, c: string) => void}) =>
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
          <UniversalAppProvider
            openUrl={() => {}}
            openRoute={null}
            universalClient={{request: async () => ({})} as any}
          >
            <TooltipProvider>
              <DocumentMetadataView
                metadata={{name: 'Character', schemaDefinition: `ipfs://${stats}`, stats: `ipfs://${stats}`} as any}
                canEdit
                onMetadata={() => {}}
                directEdit={directEdit}
              />
            </TooltipProvider>
          </UniversalAppProvider>
        </QueryClientProvider>,
      ),
    )

  it('every ipfs object field — schemaDefinition included — gets the in-context pencil when editable', () => {
    const onEditField = vi.fn()
    mount({isFieldEditable: () => true, onEditField})
    const pencils = Array.from(
      container.querySelectorAll('[aria-label="Edit linked object"][data-direct-edit="true"]'),
    ) as HTMLButtonElement[]
    expect(pencils).toHaveLength(2)
    pencils.forEach((p) => act(() => p.click()))
    expect(onEditField.mock.calls.map((c) => c[0]).sort()).toEqual(['schemaDefinition', 'stats'])
    expect(onEditField).toHaveBeenCalledWith('schemaDefinition', stats)
    // No hardcoded schema row.
    expect(container.textContent).not.toContain('Define schema')
    expect(container.textContent).not.toContain('Edit as form')
  })

  it('hides in-context editing when the draft already overrides the field', () => {
    const onEditField = vi.fn()
    mount({isFieldEditable: (k) => k !== 'schemaDefinition' && k !== 'stats', onEditField})
    expect(container.querySelector('[aria-label="Edit linked object"]')).toBeNull()
    // The pills are still there (open + ✕), just no in-context pencil.
    expect(container.querySelectorAll('[data-testid="ipfs-object-pill"]').length).toBe(2)
  })

  it('has no in-context editing without a provider (unpublished document)', () => {
    mount(undefined)
    expect(container.querySelector('[data-direct-edit="true"]')).toBeNull()
  })
})
