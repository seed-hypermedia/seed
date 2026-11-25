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

const directoryMock = vi.hoisted(() => ({
  data: [] as any[],
  resourcesById: {} as Record<string, any>,
}))

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
  useDirectory: () => ({data: directoryMock.data, isLoading: false}),
  useResources: (ids: any[]) =>
    (ids || []).map((id) => directoryMock.resourcesById[id.id] || {data: {type: 'not-found', id}}),
}))

vi.mock('@shm/shared/models/search', () => ({
  useSearch: () => ({data: {entities: []}, isLoading: false}),
}))

vi.mock('../components/dialog', () => ({
  DialogTitle: ({children, className}: {children: React.ReactNode; className?: string}) => (
    <h2 className={className}>{children}</h2>
  ),
  DialogDescription: ({children, className}: {children: React.ReactNode; className?: string}) => (
    <p className={className}>{children}</p>
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
  directoryMock.data = []
  directoryMock.resourcesById = {}
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
      expect.objectContaining({id: siteId, name: 'Docs', icon: 'site-icon', size: 24}),
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

  describe('move-children mode', () => {
    const moveChildrenInput: DocumentDestinationDialogInput = {id: sourceId, mode: 'move-children'}
    const childA = {id: hmId('site', {path: ['old-parent', 'move-me', 'a']}), path: ['old-parent', 'move-me', 'a']}
    const childB = {id: hmId('site', {path: ['old-parent', 'move-me', 'b']}), path: ['old-parent', 'move-me', 'b']}

    it('hides the URL Path section, lists destinations, and submits the target parent', async () => {
      directoryMock.data = [childA, childB, {path: ['old-parent', 'move-me', 'a', 'deep']}]
      const {onSubmit} = renderDialog({
        input: moveChildrenInput,
        enabledModes: ['move-children'],
        writableDocuments: [
          {id: siteId, title: 'Docs', document: {version: 'v1', metadata: {name: 'Docs'}} as any},
          // The writable parent of the source, so the default "move up one level" target is writable.
          {
            id: hmId('site', {path: ['old-parent']}),
            title: 'Old parent',
            document: {version: 'v1', metadata: {name: 'Old parent'}} as any,
          },
        ],
      })

      expect(container.textContent).toContain('Move children of "Move me"')
      expect(container.textContent).not.toContain('URL Path')
      expect(container.querySelector('input[placeholder="url-path"]')).toBeNull()
      expect(container.textContent).toContain('2 documents will move')

      const showButton = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Show',
      ) as HTMLButtonElement
      await act(async () => {
        showButton.click()
      })
      expect(container.textContent).toContain('old-parent/a')
      expect(container.textContent).toContain('old-parent/b')

      const submitButton = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Move and delete',
      ) as HTMLButtonElement
      expect(submitButton.disabled).toBe(false)
      await act(async () => {
        submitButton.click()
      })
      expect(onSubmit).toHaveBeenCalledWith({
        from: sourceId,
        to: hmId('site', {path: ['old-parent']}),
        mode: 'move-children',
        signingAccountId: 'site',
      })
    })

    it('shows the destination conflict message', () => {
      directoryMock.data = [childA]
      const conflictId = hmId('site', {path: ['old-parent', 'a']})
      directoryMock.resourcesById[conflictId.id] = {
        data: {type: 'document', id: conflictId, document: {metadata: {name: 'Taken'}, version: 'v1'}},
      }
      renderDialog({
        input: moveChildrenInput,
        enabledModes: ['move-children'],
        writableDocuments: [
          {
            id: hmId('site', {path: ['old-parent']}),
            title: 'Old parent',
            document: {version: 'v1', metadata: {name: 'Old parent'}} as any,
          },
        ],
      })

      expect(container.textContent).toContain(
        'A document already exists at /old-parent/a. Choose a different location.',
      )
    })

    it('blocks a target inside the document subtree', async () => {
      // The location list offers the source itself; picking it puts the target inside the subtree.
      directoryMock.data = [
        {
          id: sourceId,
          path: ['old-parent', 'move-me'],
          metadata: {name: 'Move me'},
          visibility: 'PUBLIC',
          version: 'v1',
        },
      ]
      renderDialog({
        input: moveChildrenInput,
        enabledModes: ['move-children'],
        writableDocuments: [
          {
            id: hmId('site', {path: ['old-parent']}),
            title: 'Old parent',
            document: {version: 'v1', metadata: {name: 'Old parent'}} as any,
          },
          {id: sourceId, title: 'Move me', document: {version: 'v1', metadata: {name: 'Move me'}} as any},
        ],
      })

      const row = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Move me'),
      ) as HTMLButtonElement
      expect(row).toBeTruthy()
      await act(async () => {
        row.click()
      })
      expect(container.textContent).toContain('Choose a location outside this document subtree.')
    })
  })
})
