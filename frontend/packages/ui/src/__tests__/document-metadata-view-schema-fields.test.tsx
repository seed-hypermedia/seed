// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {UniversalAppProvider} from '@shm/shared/routing'
import type {ReactNode} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DocumentMetadataView} from '../document-metadata-view'
import {HM_SCHEMAS} from '../schema/engine'
import {metadataSchemaOf} from '../schema/schema-resolve'
import {TooltipProvider} from '../tooltip'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.setConfig({testTimeout: 20_000})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const testClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
function AppShell({children}: {children: ReactNode}) {
  return (
    <QueryClientProvider client={testClient}>
      <UniversalAppProvider openUrl={() => {}} openRoute={null} universalClient={{request: async () => null} as any}>
        <TooltipProvider>{children}</TooltipProvider>
      </UniversalAppProvider>
    </QueryClientProvider>
  )
}

// example/character-doc: born + role required; died, home, faction (…) optional.
const character = () => metadataSchemaOf(HM_SCHEMAS['example/character-doc'])!
const rowKeys = () =>
  [...container.querySelectorAll('[title], dt')]
    .map((el) => (el.tagName === 'DT' ? el.textContent : el.getAttribute('title')))
    .filter(Boolean)

describe('DocumentMetadataView: fields the attributes schema declares', () => {
  it('shows the optional schema fields to a writer without adding them, and stages nothing', () => {
    const onMetadata = vi.fn()
    act(() =>
      root.render(
        <AppShell>
          <DocumentMetadataView
            metadata={{name: 'Ada', born: '1815-12-10'} as any}
            canEdit
            onMetadata={onMetadata}
            conformanceSchema={character()}
          />
        </AppShell>,
      ),
    )
    const text = container.textContent ?? ''
    for (const key of ['born', 'role', 'died', 'home', 'faction']) expect(text).toContain(key)
    // required first, then optional in schema order
    expect(text.indexOf('role')).toBeLessThan(text.indexOf('died'))
    expect(text.indexOf('died')).toBeLessThan(text.indexOf('home'))
    expect(onMetadata.mock.calls).toEqual([])
  })

  it('shows readers every schema field, with "not set" for the missing ones', () => {
    act(() =>
      root.render(
        <AppShell>
          <DocumentMetadataView metadata={{name: 'Ada', born: '1815-12-10'} as any} conformanceSchema={character()} />
        </AppShell>,
      ),
    )
    const labels = [...container.querySelectorAll('dt')].map((dt) => dt.textContent)
    expect(labels).toEqual(expect.arrayContaining(['born', 'role', 'died', 'home', 'faction']))
    expect(container.textContent).toContain('1815-12-10')
    expect(container.textContent).toContain('not set')
  })
})
