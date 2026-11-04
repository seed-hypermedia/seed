// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {UniversalAppProvider} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  DocumentDestinationDialog,
  type DocumentDestinationDialogInput,
  type WritableDocumentDestination,
} from '../document-destination-dialog'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const hmIconMock = vi.hoisted(() => vi.fn(() => <span data-testid="hm-icon" />))
const siteId = hmId('site')
const otherSiteId = hmId('other')
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
  HMIcon: hmIconMock,
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
  hmIconMock.mockClear()
})

async function clearToWritableRoots() {
  for (let index = 0; index < 2; index++) {
    const backButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Back')
    if (!backButton) return
    await act(async () => {
      backButton.click()
    })
  }
}

function renderDialog(props: {
  input?: DocumentDestinationDialogInput
  onSubmit?: ReturnType<typeof vi.fn>
  writableDocuments?: WritableDocumentDestination[]
  enabledModes?: React.ComponentProps<typeof DocumentDestinationDialog>['enabledModes']
}) {
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
          input={props.input || {id: sourceId, mode: 'move'}}
          onClose={vi.fn()}
          selectedAccountUid="site"
          enabledModes={props.enabledModes}
          writableDocuments={
            props.writableDocuments || [
              {
                id: siteId,
                title: 'Docs',
                document: {version: 'v1', metadata: {name: 'Docs', icon: 'site-icon'}} as any,
              },
            ]
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
  it('adopts an agent by choosing a space and a path only, keeping the agent name', async () => {
    const deepGrant = hmId('other', {path: ['team', 'docs']})
    const {onSubmit} = renderDialog({
      input: {id: siteId, mode: 'mount-agent', mountName: 'Scout'},
      enabledModes: ['mount-agent'],
      writableDocuments: [
        {id: siteId, title: 'Docs', document: {version: 'v1', metadata: {name: 'Docs'}} as any},
        // A grant inside another space is not a space: it must not be offered.
        {id: deepGrant, title: 'Deep', document: {version: 'v1', metadata: {name: 'Deep'}} as any},
      ],
    })

    expect(container.textContent).toContain('Choose a space')
    expect(container.textContent).toContain('Docs')
    expect(container.textContent).not.toContain('Deep')
    // No search, no name field: the document keeps the agent's name.
    expect(container.querySelector('input[placeholder="Search location…"]')).toBeNull()
    expect(container.querySelector('input[placeholder="New Scout"]')).toBeNull()
    expect((container.querySelector('input[placeholder="url-path"]') as HTMLInputElement).value).toBe('scout')

    const spaceRow = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Docs'),
    )
    await act(async () => {
      spaceRow?.click()
    })
    // The chosen space is shown with a way to change it, and nothing inside it is offered.
    expect(container.textContent).toContain('Space')
    expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Change')).toBe(
      true,
    )
    expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Back')).toBe(false)

    const adoptButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Adopt Agent',
    )
    await act(async () => {
      adoptButton?.click()
    })
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({to: hmId('site', {path: ['scout']}), mode: 'mount-agent', name: 'Scout'}),
    )
  })

  it('passes destination metadata icons into location rows', async () => {
    renderDialog({})
    await clearToWritableRoots()

    expect(hmIconMock).toHaveBeenCalledWith(
      expect.objectContaining({id: siteId, name: 'Docs', icon: 'site-icon', size: 28}),
      expect.anything(),
    )
  })

  it('filters writable roots to the source site for moves but not republish', async () => {
    renderDialog({
      input: {id: sourceId, mode: 'move'},
      writableDocuments: [
        {id: siteId, title: 'Docs', document: {version: 'v1', metadata: {name: 'Docs'}} as any},
        {id: otherSiteId, title: 'Other Site', document: {version: 'v1', metadata: {name: 'Other Site'}} as any},
      ],
    })

    await clearToWritableRoots()

    expect(container.textContent).toContain('Docs')
    expect(container.textContent).not.toContain('Other Site')

    act(() => {
      root.unmount()
      container.remove()
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
    })

    renderDialog({
      input: {id: sourceId, mode: 'republish'},
      writableDocuments: [
        {id: siteId, title: 'Docs', document: {version: 'v1', metadata: {name: 'Docs'}} as any},
        {id: otherSiteId, title: 'Other Site', document: {version: 'v1', metadata: {name: 'Other Site'}} as any},
      ],
    })
    await clearToWritableRoots()

    expect(container.textContent).toContain('Docs')
    expect(container.textContent).toContain('Other Site')
  })
})
