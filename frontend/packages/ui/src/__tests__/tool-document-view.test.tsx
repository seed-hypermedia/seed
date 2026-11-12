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
  update: vi.fn(async () => {}),
}))

vi.mock('@shm/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared')>()),
  useUniversalClient: () => ({request: vi.fn()}),
}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavigate: () => mocks.navigate}))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: () => ({data: 'export default async function (input) {\n  return {}\n}\n', isLoading: false}),
}))
vi.mock('../get-file-url', () => ({useFileUrl: () => (url: string) => url}))
vi.mock('../schema/schema-resolve', () => ({useResolvedSchema: () => ({schema: undefined, isLoading: false})}))
vi.mock('../apps/publish', () => ({
  useAppsPublisher: () => ({update: mocks.update}),
  setAttribute: (key: string, value: string | null) => ({type: 'SetAttributes', attrs: [{key: [key], value}]}),
  toolCodeFolder: async () => ({code: 'ipfs://bafynewcode', blobs: [{cid: 'bafynewcode', data: new Uint8Array()}]}),
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
  mocks.update.mockClear()
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

describe('ToolDocumentView', () => {
  it('is one page under a session-style header that goes back to the app tools', () => {
    act(() => root.render(<ToolDocumentView docId={toolId} document={tool} canEdit />))
    expect((container.querySelector('input[aria-label="Tool name"]') as HTMLInputElement).value).toBe('forecast')
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

  it('saves name, description and code in one publish', async () => {
    act(() => root.render(<ToolDocumentView docId={toolId} document={tool} canEdit />))
    setValue(container.querySelector('input[aria-label="Tool name"]')!, 'daily-forecast')
    setValue(container.querySelector('textarea[aria-label="Tool description"]')!, 'Daily forecast.')
    setValue(container.querySelector('textarea[aria-label="forecast index.ts"]')!, 'export default async () => 1\n')
    const save = Array.from(container.querySelectorAll('button')).find((el) => el.textContent?.includes('Save'))!
    await act(async () => save.click())
    expect(mocks.update).toHaveBeenCalledTimes(1)
    const [id, ops, blobs] = mocks.update.mock.calls[0] as unknown as [
      {id: string},
      {attrs: {key: string[]; value: unknown}[]}[],
      unknown[],
    ]
    expect(id.id).toBe(toolId.id)
    expect(ops.map((op) => [op.attrs[0]!.key[0], op.attrs[0]!.value])).toEqual([
      ['name', 'daily-forecast'],
      ['summary', 'Daily forecast.'],
      ['code', 'ipfs://bafynewcode'],
    ])
    expect(blobs).toHaveLength(1)
  })

  it('shows readers the tool without editing controls', () => {
    act(() => root.render(<ToolDocumentView docId={toolId} document={tool} canEdit={false} />))
    expect(container.querySelector('input[aria-label="Tool name"]')).toBeNull()
    expect(container.textContent).toContain('forecast')
    expect(container.textContent).toContain('Forecast for a city.')
  })
})
