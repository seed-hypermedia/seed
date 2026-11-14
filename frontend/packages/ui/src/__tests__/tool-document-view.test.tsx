// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ToolDocumentView} from '../apps/tool-view'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const appId = hmId('alice', {path: ['weather']})
const toolId = hmId('alice', {path: ['weather', 'forecast']})

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  change: vi.fn(),
  storeBlobs: vi.fn(async () => {}),
  metadata: {} as Record<string, unknown>,
}))

vi.mock('@shm/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared')>()),
  useUniversalClient: () => ({request: vi.fn()}),
}))
vi.mock('../apps/running', () => ({
  ToolRunSection: () => <div data-testid="tool-run" />,
  AppRunningSection: () => <div data-testid="app-running" />,
  AppPublicConfigSection: () => null,
  AppRunStatus: () => null,
  useAppRun: () => ({status: {data: null}}),
  useAppServerUrl: () => ({serverUrl: '', isLoading: false}),
}))
vi.mock('@shm/shared/models/entity', () => ({useResource: () => ({data: undefined})}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavigate: () => mocks.navigate}))
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
