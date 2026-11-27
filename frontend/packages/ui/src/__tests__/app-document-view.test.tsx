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
  update: vi.fn(async (..._args: unknown[]) => {}),
  request: vi.fn(),
  openDialog: vi.fn(),
  resources: new Map<string, unknown>(),
  directory: [] as unknown[],
  missing: {public: [] as string[], private: [] as string[]},
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResources: (ids: {id: string}[]) => ids.map((id) => ({data: mocks.resources.get(id.id), isInitialLoading: false})),
  useResource: () => ({data: undefined}),
  useDirectory: () => ({data: mocks.directory}),
}))
// The overview asks which required config the app lacks; these apps lack none.
vi.mock('../apps/app-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../apps/app-settings')>()),
  useAppMissingConfig: () => mocks.missing,
}))
vi.mock('../apps/running', () => ({
  ToolRunSection: () => <div data-testid="tool-run" />,
  AppRunningSection: () => <div data-testid="app-running" />,
  AppPublicConfigSection: () => null,
  AppRunStatus: () => null,
  useAppRun: () => ({status: {data: null}}),
  useAppServerUrl: () => ({serverUrl: '', isLoading: false}),
  useHostTriggers: () => ({data: undefined, isInitialLoading: false}),
}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavigate: () => mocks.navigate}))
vi.mock('@shm/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared')>()),
  useUniversalClient: () => ({request: mocks.request}),
}))
vi.mock('../universal-dialog', () => ({useAppDialog: () => ({open: mocks.openDialog, content: null})}))
vi.mock('../apps/publish', () => ({
  useAppsPublisher: () => ({canSign: true, addToApp: mocks.addToApp, update: mocks.update}),
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
  mocks.update.mockClear()
  mocks.request.mockReset()
  mocks.openDialog.mockClear()
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

  describe('tools used by reference', () => {
    const convertId = hmId('bob', {path: ['tools', 'convert']})
    const unitsId = hmId('alice', {path: ['shared', 'units']})
    const guideId = hmId('docs', {path: ['guide']})
    const tool = (name: string, version: string) => ({
      type: 'document',
      document: {...doc({name, summary: `${name} things.`, type: 'hm://hyper.media/tool'}), version},
    })
    const withReferences = doc({name: 'Weather', type: 'hm://hyper.media/app'}, [
      embed('b1', forecastId.id),
      embed('r1', `${convertId.id}?v=bafyold`),
      embed('r2', unitsId.id),
      // A card of a document that is not a tool is content, not one of the app's tools.
      embed('r3', guideId.id),
    ])
    const click = (text: string, index = 0) => {
      const found = Array.from(container.querySelectorAll('button')).filter((el) => el.textContent?.trim() === text)
      act(() => found[index]!.click())
    }
    /** The link the last published change gave a reference, or what it removed. */
    const published = () => JSON.stringify(mocks.update.mock.calls.at(-1)?.[1])

    beforeEach(() => {
      mocks.resources.set(convertId.id, tool('convert', 'bafynew'))
      mocks.resources.set(unitsId.id, tool('units', 'bafyunits'))
      mocks.resources.set(guideId.id, {type: 'document', document: doc({name: 'Guide'})})
    })

    it('lists them apart from the app’s own tools, saying where each is from and which version runs', () => {
      act(() => root.render(<AppDocumentView docId={appId} document={withReferences} appView="tools" canEdit />))
      const section = container.querySelector('[data-testid="referenced-tools"]')!
      expect(section.textContent).toContain('From elsewhere')
      expect(section.textContent).toContain('convert')
      expect(section.textContent).toContain('Pinned to an earlier version. A newer one is published.')
      expect(section.textContent).toContain('units')
      expect(section.textContent).toContain('Follows the latest version.')
      expect(section.textContent).not.toContain('Guide')
      // The app's own tool stays above, outside the section.
      expect(section.textContent).not.toContain('Forecast for a city.')
      expect(container.textContent).toContain('Forecast for a city.')
    })

    it('moves a pinned tool to the newer version, lets it follow the latest, pins one, and removes one', async () => {
      act(() => root.render(<AppDocumentView docId={appId} document={withReferences} appView="tools" canEdit />))
      click('Update')
      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({id: appId.id}), expect.anything())
      expect(published()).toContain(`${convertId.id}?v=bafynew`)
      await act(async () => {})
      click('Follow latest')
      expect(published()).toContain(convertId.id)
      expect(published()).not.toContain('?v=')
      await act(async () => {})
      // The tool that follows the latest is pinned to the version on screen.
      click('Pin')
      expect(published()).toContain(`${unitsId.id}?v=bafyunits`)
      await act(async () => {})
      click('Remove', 1)
      expect(published()).toContain('DeleteBlocks')
      expect(published()).toContain('r2')
    })

    it('offers, above the list, to make a tool or to add one that lives elsewhere', () => {
      const plain = doc({name: 'Weather', type: 'hm://hyper.media/app'}, [embed('b1', forecastId.id)])
      act(() => root.render(<AppDocumentView docId={appId} document={plain} appView="tools" canEdit />))
      const actions = container.querySelector('[data-testid="add-tool-actions"]')!
      expect(Array.from(actions.querySelectorAll('button')).map((el) => el.textContent)).toEqual([
        'New tool',
        'Add existing tool',
      ])
      // An app that references nothing shows no empty section for it.
      expect(container.querySelector('[data-testid="referenced-tools"]')).toBeNull()
      click('Add existing tool')
      expect(mocks.openDialog).toHaveBeenLastCalledWith({
        host: {id: expect.objectContaining({id: appId.id}), document: plain},
      })
      click('New tool')
      expect(mocks.openDialog).toHaveBeenLastCalledWith({
        app: {id: expect.objectContaining({id: appId.id}), document: plain},
      })
    })

    it('shows readers the list with nothing to change', () => {
      act(() =>
        root.render(<AppDocumentView docId={appId} document={withReferences} appView="tools" canEdit={false} />),
      )
      expect(container.textContent).toContain('convert')
      expect(Array.from(container.querySelectorAll('button')).map((el) => el.textContent)).not.toContain('Remove')
      expect(container.querySelector('[data-testid="add-tool-actions"]')).toBeNull()
    })
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
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('says in red, on the overview, which required config the app lacks', () => {
    mocks.missing = {public: ['mode'], private: ['datalabApiKey']}
    try {
      act(() => root.render(<AppDocumentView docId={appId} document={app} appView={undefined} canEdit />))
      const alert = container.querySelector('[role="alert"]')!
      expect(alert.textContent).toContain('Config missing: mode, datalabApiKey')
      expect(alert.className).toContain('text-destructive')
    } finally {
      mocks.missing = {public: [], private: []}
    }
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
