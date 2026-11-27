// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DocumentActionsProvider} from '@shm/shared/document-actions-context'
import {ToolDocumentView} from '../apps/tool-view'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const appId = hmId('alice', {path: ['weather']})
const toolId = hmId('alice', {path: ['weather', 'forecast']})

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  machineSend: vi.fn(),
  change: vi.fn(),
  storeBlobs: vi.fn(async () => {}),
  metadata: {} as Record<string, unknown>,
  hasDraft: false,
  parent: undefined as unknown,
  run: [] as Record<string, unknown>[],
  missing: {public: [] as string[], private: [] as string[]},
  setPrivate: vi.fn(),
  runConfigInput: undefined as Record<string, unknown> | undefined,
  openUseInHost: vi.fn(),
}))

vi.mock('@shm/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared')>()),
  useUniversalClient: () => ({request: vi.fn()}),
}))
vi.mock('../apps/running', () => ({
  ToolRunSection: (props: Record<string, unknown>) => {
    mocks.run.push(props)
    return <div data-testid="tool-run" />
  },
  AppRunningSection: () => <div data-testid="app-running" />,
  AppPublicConfigSection: () => null,
  AppRunStatus: () => null,
  useAppRun: () => ({status: {data: null}}),
  useAppServerUrl: () => ({serverUrl: '', isLoading: false}),
}))
vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: mocks.parent, isInitialLoading: false}),
}))
vi.mock('../apps/app-settings', () => ({
  HostSettings: ({kind, standalone}: {kind: string; standalone?: boolean}) => (
    <div data-testid="host-settings" data-kind={kind} data-standalone={String(!!standalone)} />
  ),
  useToolRunConfig: (input: Record<string, unknown>) => {
    mocks.runConfigInput = input
    return {missing: mocks.missing, setPrivate: mocks.setPrivate, dialog: null}
  },
}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavigate: () => mocks.navigate}))
// The dialog that puts a tool to use in an app or an agent has its own tests.
vi.mock('../universal-dialog', () => ({useAppDialog: () => ({open: mocks.openUseInHost, content: null})}))
vi.mock('../apps/use-tool-dialogs', () => ({UseToolInHostDialog: () => null}))
// The document's editing state, as the page's machine holds it: a document the viewer can edit
// that is not being edited yet. A click in the empty Documentation part starts the editing.
vi.mock('@shm/shared/models/use-document-machine', () => ({
  useDocumentMachineRefOptional: () => ({getSnapshot: () => ({}), send: mocks.machineSend}),
  selectCanEdit: () => true,
  selectIsEditing: () => false,
}))
vi.mock('@shm/shared/models/use-editor-gate', () => ({
  useEditorGate: () => ({canEdit: true, isEditing: false, beginEditIfNeeded: vi.fn()}),
}))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: () => ({data: 'export default async function (input) {\n  return {}\n}\n', isLoading: false}),
}))
vi.mock('../get-file-url', () => ({useFileUrl: () => (url: string) => url}))
vi.mock('../schema/schema-resolve', () => ({useResolvedSchema: () => ({schema: undefined, isLoading: false})}))
vi.mock('../apps/publish', () => ({
  toolCodeFolder: async () => ({code: 'ipfs://bafynewcode', blobs: [{cid: 'bafynewcode', data: new Uint8Array()}]}),
}))
// The tool edits its document's draft: every change stages there (the top bar publishes it).
vi.mock('../apps/resource-draft', () => ({
  useResourceDraft: () => ({
    metadata: mocks.metadata,
    content: [],
    change: mocks.change,
    storeBlobs: mocks.storeBlobs,
    canEdit: true,
    hasDraft: mocks.hasDraft,
  }),
}))
vi.mock('../toast', () => ({toast: {success: vi.fn(), error: vi.fn()}}))

const tool = {
  metadata: {name: 'forecast', summary: 'Forecast for a city.', type: 'hm://hyper.media/tool', code: 'ipfs://bafycode'},
  content: [],
  version: 'v1',
  authors: ['alice'],
  genesis: 'g',
} as unknown as HMDocument

/** The tool's parent as an app that lists it: the tool then runs inside that app. */
const listingApp = {
  type: 'document',
  document: {
    metadata: {name: 'Weather', type: 'hm://hyper.media/app'},
    content: [{block: {id: 'b1', type: 'Embed', link: toolId.id, attributes: {view: 'Card'}}, children: []}],
  },
}
/** The tool's parent as an ordinary document: the tool then stands on its own. */
const plainParent = {type: 'document', document: {metadata: {name: 'Weather notes'}, content: []}}

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.navigate.mockClear()
  mocks.change.mockClear()
  mocks.storeBlobs.mockClear()
  mocks.metadata = tool.metadata as Record<string, unknown>
  mocks.hasDraft = false
  mocks.parent = listingApp
  mocks.run.length = 0
  mocks.missing = {public: [], private: []}
  mocks.setPrivate.mockClear()
  mocks.openUseInHost.mockClear()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!
  act(() => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', {bubbles: true}))
  })
}

function openDefinition() {
  const button = Array.from(container.querySelectorAll('button')).find(
    (el) => el.textContent?.startsWith('Definition'),
  )!
  act(() => button.click())
}

describe('ToolDocumentView', () => {
  it('is one page under a session-style header that goes back to the app tools', () => {
    act(() => root.render(<ToolDocumentView docId={toolId} document={tool} canEdit />))
    expect((container.querySelector('input[aria-label="Tool name"]') as HTMLInputElement).value).toBe('forecast')
    // The definition starts folded, under Run.
    expect(container.textContent).not.toContain('index.ts')
    openDefinition()
    expect(container.textContent).toContain('Input')
    expect(container.textContent).toContain('Output')
    expect(container.textContent).toContain('index.ts')
    expect(container.textContent).not.toContain('Save')
    act(() => (container.querySelector('button[aria-label="Back to app tools"]') as HTMLButtonElement).click())
    expect(mocks.navigate).toHaveBeenCalledWith({
      key: 'document',
      id: expect.objectContaining({id: appId.id}),
      appView: 'tools',
    })
  })

  it('runs a tool an app lists with that app, which supplies the config the tool declares', () => {
    mocks.hasDraft = true
    act(() => root.render(<ToolDocumentView docId={toolId} document={tool} canEdit />))
    const run = mocks.run.at(-1)!
    expect(run.appId).toMatchObject({id: appId.id})
    expect(run.standalone).toBe(false)
    // Someone who can write the tool runs the code the page shows, published or not.
    expect(run.draft).toEqual({source: 'export default async function (input) {\n  return {}\n}\n'})
    // The tool says what config it needs; the values are the app's, so the tool page takes none.
    const config = container.querySelector('[data-testid="host-settings"]')!
    expect(config.getAttribute('data-kind')).toBe('tool')
    expect(config.getAttribute('data-standalone')).toBe('false')
    // It is in an app already: nothing offers to put it in one.
    expect(container.querySelector('[data-testid="tool-use-in-host"]')).toBeNull()
  })

  it('gives a tool outside any app its own config values, and offers to put it to use in an app or an agent', () => {
    mocks.parent = plainParent
    act(() => root.render(<ToolDocumentView docId={toolId} document={tool} canEdit />))
    const run = mocks.run.at(-1)!
    expect(run.appId).toMatchObject({id: toolId.id})
    expect(run.standalone).toBe(true)
    expect(run.draft).toMatchObject({source: expect.any(String)})
    expect(container.querySelector('[data-testid="host-settings"]')?.getAttribute('data-standalone')).toBe('true')
    // Nothing is turned on for a tool on its own: an app or an agent takes it, and it stays here.
    const useIn = container.querySelector('[data-testid="tool-use-in-host"]')!
    expect(useIn.textContent).toContain('This tool is in no app or agent.')
    act(() => useIn.querySelector('button')!.click())
    expect(mocks.openUseInHost).toHaveBeenCalledWith({
      tool: {id: expect.objectContaining({id: toolId.id}), document: tool},
    })
    // There is no app to go back to: Back goes to the document the tool sits under.
    expect(container.querySelector('button[aria-label="Back to app tools"]')).toBeNull()
    act(() => (container.querySelector('button[aria-label="Back"]') as HTMLButtonElement).click())
    expect(mocks.navigate).toHaveBeenCalledWith({key: 'document', id: expect.objectContaining({id: appId.id})})
  })

  it('holds Run back for a tool on its own until its required config is set, and opens the secret to set', () => {
    mocks.parent = plainParent
    mocks.missing = {public: [], private: ['datalabApiKey']}
    act(() => root.render(<ToolDocumentView docId={toolId} document={tool} canEdit />))
    // The tool is its own host: what it lacks is asked of the tool, as the page shows it.
    expect(mocks.runConfigInput).toMatchObject({host: {id: {id: toolId.id}}, standalone: true, canEdit: true})
    const run = mocks.run.at(-1)!
    expect(run.missingConfig).toEqual(['datalabApiKey'])
    ;(run.onSetConfig as () => void)()
    expect(mocks.setPrivate).toHaveBeenCalled()
  })

  it('sends someone to the app’s settings for the config a tool inside an app lacks', () => {
    mocks.missing = {public: ['region'], private: []}
    act(() => root.render(<ToolDocumentView docId={toolId} document={tool} canEdit />))
    expect(mocks.runConfigInput).toMatchObject({host: {id: {id: appId.id}}, standalone: false})
    const run = mocks.run.at(-1)!
    expect(run.missingConfig).toEqual(['region'])
    ;(run.onSetConfig as () => void)()
    expect(mocks.navigate).toHaveBeenCalledWith({
      key: 'document',
      id: expect.objectContaining({id: appId.id}),
      appView: 'settings',
    })
    expect(mocks.setPrivate).not.toHaveBeenCalled()
  })

  it('gives readers no code to run of a tool they cannot write', () => {
    mocks.parent = plainParent
    act(() => root.render(<ToolDocumentView docId={toolId} document={tool} canEdit={false} />))
    expect(mocks.run.at(-1)!.draft).toBeUndefined()
  })

  it('runs an earlier version for someone who can write the tool, though that page cannot be edited', () => {
    mocks.parent = plainParent
    // A version opened from the tool's history is read-only; its code runs all the same.
    act(() =>
      root.render(
        <DocumentActionsProvider canWriteDocument={(id) => id.uid === toolId.uid}>
          <ToolDocumentView docId={{...toolId, version: 'v0', latest: false}} document={tool} canEdit={false} />
        </DocumentActionsProvider>,
      ),
    )
    expect(mocks.run.at(-1)!.draft).toEqual({source: 'export default async function (input) {\n  return {}\n}\n'})
    // Nothing on the page can be changed.
    expect(container.querySelector('input[aria-label="Tool name"]')).toBeNull()
  })

  it('shows the document’s body as the tool’s documentation, between its description and Run', () => {
    act(() =>
      root.render(
        <ToolDocumentView
          docId={toolId}
          document={tool}
          canEdit
          documentation={<div data-testid="body">Check every figure after converting.</div>}
        />,
      ),
    )
    const documentation = container.querySelector('[data-testid="tool-documentation"]')!
    // The page around supplies the body and its editor; the tool page gives it a place and says what it is for.
    expect(documentation.querySelector('[data-testid="body"]')?.textContent).toBe(
      'Check every figure after converting.',
    )
    expect(container.textContent).toContain('Documentation')
    expect(container.textContent).toContain('An agent reads it when it decides to use the tool, before its first call')
    const order = (testId: string) =>
      Array.from(container.querySelectorAll('*')).indexOf(container.querySelector(testId)!)
    expect(order('textarea[aria-label="Tool description"]')).toBeLessThan(order('[data-testid="tool-documentation"]'))
    expect(order('[data-testid="tool-documentation"]')).toBeLessThan(order('[data-testid="tool-run"]'))
    // With nothing written yet there is no text to click, so the part says how to start.
    expect(documentation.textContent).toContain('No documentation yet. Click here to write it.')
    act(() => (documentation as HTMLElement).click())
    expect(mocks.machineSend).toHaveBeenCalledWith({type: 'edit.start', cursorPosition: 'end'})
    // A page that cannot render a body leaves the part out.
    act(() => root.render(<ToolDocumentView docId={toolId} document={tool} canEdit />))
    expect(container.querySelector('[data-testid="tool-documentation"]')).toBeNull()
  })

  it('tells whoever writes the description that it is all an agent sees before choosing the tool', () => {
    act(() => root.render(<ToolDocumentView docId={toolId} document={tool} canEdit />))
    expect(container.querySelector('[data-testid="tool-description-hint"]')?.textContent).toContain(
      'this is all an agent knows about the tool when it decides whether to use it',
    )
    // A reader is shown the description, not how to write one.
    act(() => root.render(<ToolDocumentView docId={toolId} document={tool} canEdit={false} />))
    expect(container.querySelector('[data-testid="tool-description-hint"]')).toBeNull()
  })

  it('stages name, description and code edits in the draft, with no Save button of its own', async () => {
    act(() => root.render(<ToolDocumentView docId={toolId} document={tool} canEdit />))
    setValue(container.querySelector('input[aria-label="Tool name"]')!, 'daily-forecast')
    expect(mocks.change).toHaveBeenLastCalledWith({name: 'daily-forecast'})
    setValue(container.querySelector('textarea[aria-label="Tool description"]')!, 'Daily forecast.')
    expect(mocks.change).toHaveBeenLastCalledWith({summary: 'Daily forecast.'})
    openDefinition()
    setValue(container.querySelector('textarea[aria-label="forecast index.ts"]')!, 'export default async () => 1\n')
    // The code becomes a published folder after a pause, and the draft points at it.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 500)))
    expect(mocks.storeBlobs).toHaveBeenCalledTimes(1)
    expect(mocks.change).toHaveBeenLastCalledWith({code: 'ipfs://bafynewcode'})
    expect(Array.from(container.querySelectorAll('button')).some((el) => el.textContent?.includes('Save'))).toBe(false)
  })

  it('shows readers the tool without editing controls', () => {
    act(() => root.render(<ToolDocumentView docId={toolId} document={tool} canEdit={false} />))
    expect(container.querySelector('input[aria-label="Tool name"]')).toBeNull()
    expect(container.textContent).toContain('forecast')
    expect(container.textContent).toContain('Forecast for a city.')
  })
})
