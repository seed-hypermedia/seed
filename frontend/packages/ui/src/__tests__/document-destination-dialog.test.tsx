// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {UniversalAppProvider} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DocumentDestinationDialog, type WritableDocumentDestination} from '../document-destination-dialog'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const siteId = hmId('site')
const sourceId = hmId('site', {path: ['old-parent', 'move-me']})

vi.mock('@shm/shared/models/entity', () => ({
  useResource: (id: any) => {
    if (!id) return {data: null}
    if (id.id === sourceId.id) {
      return {
        data: {
          type: 'document',
          id: sourceId,
          document: {metadata: {name: 'Move me'}, version: 'v1', visibility: 'PUBLIC'},
        },
      }
    }
    if (id.id === siteId.id) {
      return {
        data: {
          type: 'document',
          id: siteId,
          document: {metadata: {name: 'Docs'}, version: 'v1', visibility: 'PUBLIC'},
        },
      }
    }
    return {data: {type: 'not-found', id}}
  },
  useDirectory: () => ({data: []}),
  useResources: () => [],
}))

vi.mock('@shm/shared/models/search', () => ({
  useSearch: () => ({data: {entities: []}, isLoading: false}),
}))

vi.mock('../components/dialog', () => ({
  DialogTitle: ({children, className}: {children: React.ReactNode; className?: string}) => (
    <h2 className={className}>{children}</h2>
  ),
}))

vi.mock('../tooltip', () => ({
  Tooltip: ({children}: {children: React.ReactNode}) => <>{children}</>,
}))

vi.mock('../hm-icon', () => ({
  HMIcon: () => <span data-testid="hm-icon" />,
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function renderDialog(props: {onSubmit?: ReturnType<typeof vi.fn>; writableDocuments?: WritableDocumentDestination[]}) {
  const onSubmit = (props.onSubmit || vi.fn(async () => undefined)) as any
  act(() => {
    root.render(
      <UniversalAppProvider
        openRoute={vi.fn()}
        openUrl={vi.fn()}
        origin="http://localhost:3000"
        universalClient={{request: vi.fn()} as any}
      >
        <DocumentDestinationDialog
          input={{id: sourceId, mode: 'move'}}
          onClose={vi.fn()}
          selectedAccountUid="site"
          writableDocuments={
            props.writableDocuments || [{id: siteId, title: 'Docs', document: {metadata: {name: 'Docs'}} as any}]
          }
          onSubmit={onSubmit}
        />
      </UniversalAppProvider>,
    )
  })
  return {onSubmit}
}

describe('DocumentDestinationDialog', () => {
  it('renders the shared destination picker and submits the selected parent plus slug', async () => {
    const {onSubmit} = renderDialog({})

    expect(container.textContent).toContain('Location')
    expect(container.querySelector('input[placeholder="Search location…"]')).toBeTruthy()
    expect(container.textContent).toContain('URL Path')

    const slugInput = container.querySelector('input[placeholder="url-path"]') as HTMLInputElement
    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      nativeInputValueSetter?.call(slugInput, 'moved')
      slugInput.dispatchEvent(new Event('input', {bubbles: true}))
    })

    const moveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Move')
    await act(async () => {
      moveButton?.click()
    })

    expect(onSubmit).toHaveBeenCalledWith({
      from: sourceId,
      to: hmId('site', {path: ['old-parent', 'moved']}),
      mode: 'move',
      signingAccountId: 'site',
    })
  })
})
