// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {AppDocumentView} from '../apps/app-view'
import {appResourceKind, appResourceTabs} from '../apps/tabs'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const appId = hmId('alice', {path: ['weather']})
const forecastId = hmId('alice', {path: ['weather', 'forecast']})
const radarId = hmId('alice', {path: ['weather', 'radar']})
const strayId = hmId('alice', {path: ['weather', 'old-tool']})

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  addToApp: vi.fn(async () => {}),
  resources: new Map<string, unknown>(),
  directory: [] as unknown[],
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResources: (ids: {id: string}[]) => ids.map((id) => ({data: mocks.resources.get(id.id), isInitialLoading: false})),
  useResource: () => ({data: undefined}),
  useDirectory: () => ({data: mocks.directory}),
}))
vi.mock('../apps/running', () => ({
  ToolRunSection: () => <div data-testid="tool-run" />,
  AppRunningSection: () => <div data-testid="app-running" />,
  AppPublicConfigSection: () => null,
  AppRunStatus: () => null,
  useAppRun: () => ({status: {data: null}}),
  useAppServerUrl: () => ({serverUrl: '', isLoading: false}),
}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavigate: () => mocks.navigate}))
vi.mock('../universal-dialog', () => ({useAppDialog: () => ({open: vi.fn(), content: null})}))
vi.mock('../apps/publish', () => ({
  useAppsPublisher: () => ({canSign: true, addToApp: mocks.addToApp}),
  setAttribute: vi.fn(),
}))
vi.mock('../document-page', () => ({
  DocumentPageView: () => <div data-testid="home-page" />,
  documentPageCid: () => null,
}))

function doc(metadata: Record<string, unknown>, content: unknown[] = []): HMDocument {
  return {content, metadata, version: 'v1', authors: ['alice'], genesis: 'g'} as unknown as HMDocument
}
const embed = (id: string, link: string) => ({
  block: {type: 'Embed', id, link, attributes: {view: 'Card'}},
  children: [],
})

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.resources.clear()
  mocks.resources.set(forecastId.id, {
    type: 'document',
    document: doc({name: 'forecast', summary: 'Forecast for a city.', type: 'hm://hyper.media/tool'}),
  })
  mocks.resources.set(radarId.id, {type: 'document', document: doc({name: 'Radar', type: 'hm://hyper.media/page'})})
  mocks.directory = [
    {id: forecastId, metadata: {name: 'forecast', type: 'hm://hyper.media/tool'}},
    {id: strayId, metadata: {name: 'old-tool', type: 'hm://hyper.media/tool'}},
  ]
  mocks.navigate.mockClear()
  mocks.addToApp.mockClear()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const app = doc({name: 'Weather', summary: 'Forecasts.', type: 'hm://hyper.media/app'}, [
  embed('b1', forecastId.id),
  embed('b2', radarId.id),
])

describe('AppDocumentView', () => {
  it('lists the embedded tools in order, opens them, and offers to add unlisted ones', () => {
    act(() => root.render(<AppDocumentView docId={appId} document={app} appView="tools" canEdit />))
    expect(container.textContent).toContain('forecast')
    expect(container.textContent).toContain('Forecast for a city.')
    // A page is not a tool.
    expect(container.textContent).not.toContain('Radar')
    expect(container.textContent).toContain('Not in this app')
    expect(container.textContent).toContain('old-tool')
    const row = Array.from(container.querySelectorAll('[role="button"]')).find(
      (el) => el.textContent?.includes('Forecast for a city.'),
    ) as HTMLElement
    act(() => row.click())
    expect(mocks.navigate).toHaveBeenCalledWith({key: 'document', id: expect.objectContaining({id: forecastId.id})})
    const add = Array.from(container.querySelectorAll('button')).find((el) => el.textContent === 'Add')!
    act(() => add.click())
    expect(mocks.addToApp).toHaveBeenCalledWith(expect.objectContaining({id: appId}), strayId)
  })

  it('shows pages on the Pages tab and no editing controls to readers', () => {
    act(() => root.render(<AppDocumentView docId={appId} document={app} appView="pages" canEdit={false} />))
    expect(container.textContent).toContain('Radar')
    expect(container.textContent).not.toContain('forecast')
    expect(container.textContent).not.toContain('New tool')
  })

  it('opens on an overview when the app has no home page', () => {
    act(() => root.render(<AppDocumentView docId={appId} document={app} appView={undefined} canEdit />))
    expect(container.textContent).toContain('Weather')
    expect(container.textContent).toContain('1 tool')
    expect(container.textContent).toContain('1 page')
    expect(container.querySelector('[data-testid="home-page"]')).toBeNull()
  })
})

describe('app tabs', () => {
  it('gives apps Home, Tools, Pages, Triggers and Settings', () => {
    expect(appResourceKind('hm://hyper.media/app')).toBe('app')
    expect(appResourceKind('hm://hyper.media/tool')).toBe('tool')
    expect(appResourceKind('hm://hyper.media/trigger')).toBe('trigger')
    expect(appResourceKind('hm://hyper.media/page')).toBeNull()
    const tabs = appResourceTabs(appId, 'tools')
    expect(tabs.map((tab) => [tab.label, tab.active])).toEqual([
      ['Home', false],
      ['Tools', true],
      ['Pages', false],
      ['Triggers', false],
      ['Settings', false],
    ])
    expect(tabs[0]!.route).toMatchObject({key: 'document', id: {id: appId.id}})
    expect(tabs[0]!.route).not.toHaveProperty('appView')
  })
})
