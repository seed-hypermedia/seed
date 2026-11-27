// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DocumentActionsProvider} from '@shm/shared/document-actions-context'
import {AddExistingToolDialog, UseToolInHostDialog} from '../apps/use-tool-dialogs'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const TOOL = 'hm://hyper.media/tool'
const APP = 'hm://hyper.media/app'
const AGENT = 'hm://hyper.media/agent'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  update: vi.fn(async (..._args: unknown[]) => {}),
  copyInto: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
  request: vi.fn(),
  success: vi.fn(),
  // What each space lists, what search finds anywhere, and the documents that can be read by id.
  directories: {} as Record<string, unknown[]>,
  search: [] as unknown[],
  resources: new Map<string, unknown>(),
  // The config the picked tool declares.
  declared: {publicFields: [] as {name: string}[], privateFields: [] as {name: string}[]},
}))

vi.mock('@shm/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared')>()),
  useUniversalClient: () => ({request: mocks.request}),
}))
vi.mock('@shm/shared/models/entity', () => ({
  useDirectory: (id: {uid: string} | null) => ({data: id ? mocks.directories[id.uid] ?? [] : undefined}),
  useResource: (id: {id: string} | null) => ({data: id ? mocks.resources.get(id.id) : undefined, isLoading: false}),
  useResources: (ids: {id: string}[]) => ids.map((id) => ({data: mocks.resources.get(id.id), isInitialLoading: false})),
}))
vi.mock('@shm/shared/models/search', () => ({
  useSearch: (_query: string, {enabled}: {enabled: boolean}) => ({
    data: enabled ? {entities: mocks.search} : undefined,
    isLoading: false,
  }),
}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavigate: () => mocks.navigate}))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: ({enabled}: {enabled: boolean}) => ({data: enabled ? mocks.declared : undefined}),
}))
vi.mock('../apps/app-settings', () => ({toolConfigFields: vi.fn()}))
vi.mock('../apps/publish', () => ({useAppsPublisher: () => ({update: mocks.update, copyInto: mocks.copyInto})}))
vi.mock('../components/dialog', () => ({
  DialogTitle: ({children}: {children: React.ReactNode}) => <h2>{children}</h2>,
  DialogDescription: ({children}: {children: React.ReactNode}) => <p>{children}</p>,
}))
vi.mock('../toast', () => ({toast: {success: mocks.success, error: vi.fn()}}))

const appId = hmId('alice', {path: ['weather']})
const ownToolId = hmId('alice', {path: ['weather', 'forecast']})
const unitsId = hmId('alice', {path: ['shared', 'units']})
const convertId = hmId('bob', {path: ['tools', 'convert']})
const linkedId = hmId('bob', {path: ['tools', 'radar']})
const guideId = hmId('bob', {path: ['guide']})
const farId = hmId('carol', {path: ['geocode']})

const listed = (id: UnpackedHypermediaId, metadata: Record<string, unknown>, version = 'v1') => ({
  id,
  metadata,
  version,
})
const read = (metadata: Record<string, unknown>, version = 'v1', content: unknown[] = []) => ({
  type: 'document',
  document: {metadata, version, content} as unknown as HMDocument,
})
const card = (id: string, link: string) => ({
  block: {type: 'Embed', id, link, attributes: {view: 'Card'}},
  children: [],
})

const host = {
  id: appId,
  document: {
    metadata: {name: 'Weather', type: APP},
    content: [card('b1', ownToolId.id), card('r1', linkedId.id)],
  } as unknown as HMDocument,
}

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  mocks.directories = {
    alice: [
      listed(appId, {name: 'Weather', summary: 'Forecasts.', type: APP}),
      listed(ownToolId, {name: 'forecast', summary: 'Forecast for a city.', type: TOOL}),
      listed(unitsId, {name: 'units', summary: 'Converts between metric and imperial.', type: TOOL}, 'bafyunits'),
      listed(hmId('alice', {path: ['helper']}), {name: 'Helper', type: AGENT}),
      listed(hmId('alice', {path: ['notes']}), {name: 'Notes'}),
    ],
    bob: [
      listed(convertId, {name: 'convert', type: TOOL}, 'bafyconv'),
      listed(linkedId, {name: 'radar', summary: 'Rain radar tiles.', type: TOOL}),
      listed(guideId, {name: 'Guide'}),
      listed(hmId('bob', {path: ['importer']}), {name: 'Importer', type: AGENT}),
    ],
  }
  mocks.search = []
  mocks.resources = new Map<string, unknown>([
    [farId.id, read({name: 'geocode', summary: 'Coordinates of a place, by name.', type: TOOL}, 'bafygeo')],
    [guideId.id, read({name: 'Guide'})],
    [ownToolId.id, read({name: 'forecast', summary: 'Forecast for a city.', type: TOOL})],
    [convertId.id, read({name: 'convert', type: TOOL}, 'bafyconv')],
  ])
  mocks.declared = {publicFields: [], privateFields: []}
  mocks.copyInto.mockResolvedValue(hmId('alice', {path: ['weather', 'convert']}))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** Renders a dialog for alice, who can write her own space and nothing else. */
function render(dialog: React.ReactNode, account = 'alice') {
  act(() =>
    root.render(
      <DocumentActionsProvider selectedAccountUid={account} canWriteDocument={(id) => id.uid === account}>
        {dialog}
      </DocumentActionsProvider>,
    ),
  )
}
const options = () => Array.from(container.querySelectorAll('[role="option"]'))
// A row holds the name, the description and the space, in that order.
const names = () => options().map((option) => option.firstElementChild?.firstElementChild?.textContent ?? '')
const option = (name: string) => options().find((el) => el.textContent?.startsWith(name)) as HTMLButtonElement
const button = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((el) => el.textContent?.trim() === text) as HTMLButtonElement
/** One of the three ways to use a tool: its radio button, and the text beside it. */
type Mode = 'latest' | 'pinned' | 'copy'
const radio = (mode: Mode) => container.querySelector(`#use-tool-mode-${mode}`) as HTMLButtonElement
const radioText = (mode: Mode) => container.querySelector(`label[for="use-tool-mode-${mode}"]`)?.textContent ?? ''
const checked = () =>
  Array.from(container.querySelectorAll('[role="radio"][aria-checked="true"]')).map((el) =>
    el.id.replace('use-tool-mode-', ''),
  )
function type(text: string) {
  const input = container.querySelector('input')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
}
async function confirm(label: string) {
  await act(async () => {
    button(label).click()
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}
/** The change the last publish made to the host. */
const published = () => JSON.stringify(mocks.update.mock.calls.at(-1)?.[1])

describe('AddExistingToolDialog', () => {
  it('lists the tools nearby with their descriptions, without the ones the host already has', () => {
    // Bob's app, opened by alice: the tools of the app's space and of her own are listed.
    const bobsHost = {...host, id: hmId('bob', {path: ['weather']})}
    render(<AddExistingToolDialog input={{host: bobsHost}} onClose={vi.fn()} />)
    expect(names()).toEqual(['convert', 'units'])
    // Not radar or forecast, which the host links to already, and no document that is not a tool.
    expect(container.textContent).not.toContain('forecast')
    expect(container.textContent).not.toContain('radar')
    expect(container.textContent).not.toContain('Guide')
    // The description is the line an agent goes by: a tool without one says so.
    expect(option('units').textContent).toContain('Converts between metric and imperial.')
    expect(option('convert').textContent).toContain('No description.')
    // Nothing can be added until a tool is picked.
    expect(button('Link tool').disabled).toBe(true)
    expect(container.querySelector('[role="radiogroup"]')).toBeNull()
  })

  it('leaves out the host’s own tools', () => {
    render(<AddExistingToolDialog input={{host}} onClose={vi.fn()} />)
    expect(names()).toEqual(['units'])
  })

  it('marks the picked tool with a check, and asks how to use it with three radio buttons', () => {
    render(<AddExistingToolDialog input={{host}} onClose={vi.fn()} />)
    act(() => option('units').click())
    expect(option('units').getAttribute('aria-selected')).toBe('true')
    expect(option('units').querySelector('svg')).not.toBeNull()
    // The choice is its own group, under its own heading, and reads as one of three.
    const group = container.querySelector('[role="radiogroup"]')!
    expect(container.querySelector(`#${group.getAttribute('aria-labelledby')}`)?.textContent).toBe(
      'How this app uses it',
    )
    expect(Array.from(group.querySelectorAll('label')).map((el) => el.firstElementChild?.textContent)).toEqual([
      'Link, always the latest version',
      'Link, this version only',
      'Copy',
    ])
    act(() => radio('copy').click())
    expect(checked()).toEqual(['copy'])
    expect(button('Copy tool')).toBeDefined()
  })

  it('starts someone else’s tool pinned to the version on screen, and one’s own on its latest', async () => {
    const onClose = vi.fn()
    mocks.directories.alice!.push(listed(convertId, {name: 'convert', type: TOOL}, 'bafyconv'))
    render(<AddExistingToolDialog input={{host}} onClose={onClose} />)
    // Bob's tool: his next version does not run here unless alice says so.
    act(() => option('convert').click())
    expect(checked()).toEqual(['pinned'])
    expect(radioText('pinned')).toContain('keeps running the version you see now')
    // Following it is offered, and says whom that trusts and with what.
    expect(radioText('latest')).toContain('runs whatever its author publishes there, with the secrets')
    await confirm('Link tool')
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({id: appId.id}), expect.anything())
    expect(published()).toContain(`${convertId.id}?v=bafyconv`)
    expect(mocks.success).toHaveBeenCalledWith('Linked convert, pinned to this version')
    expect(onClose).toHaveBeenCalled()
    // A linked tool stays where it is: there is nowhere new to go.
    expect(mocks.navigate).not.toHaveBeenCalled()

    // Her own tool: the next thing she publishes is what she wants to run.
    act(() => option('units').click())
    expect(checked()).toEqual(['latest'])
    expect(radioText('latest')).toContain('runs whatever you publish there')
    await confirm('Link tool')
    expect(published()).toContain(unitsId.id)
    expect(published()).not.toContain('?v=')
    expect(mocks.success).toHaveBeenLastCalledWith('Linked units')
  })

  it('links either way when asked: someone else’s tool on its latest, one’s own pinned', async () => {
    mocks.directories.alice!.push(listed(convertId, {name: 'convert', type: TOOL}, 'bafyconv'))
    render(<AddExistingToolDialog input={{host}} onClose={vi.fn()} />)
    act(() => option('convert').click())
    act(() => radio('latest').click())
    await confirm('Link tool')
    expect(published()).toContain(convertId.id)
    expect(published()).not.toContain('?v=')

    act(() => option('units').click())
    act(() => radio('pinned').click())
    await confirm('Link tool')
    expect(published()).toContain(`${unitsId.id}?v=bafyunits`)
    expect(mocks.success).toHaveBeenLastCalledWith('Linked units, pinned to this version')
  })

  it('goes back to a tool’s own first choice when another tool is picked', () => {
    mocks.directories.alice!.push(listed(convertId, {name: 'convert', type: TOOL}, 'bafyconv'))
    render(<AddExistingToolDialog input={{host}} onClose={vi.fn()} />)
    act(() => option('units').click())
    expect(checked()).toEqual(['latest'])
    // What was right for her own tool is not carried over to Bob's.
    act(() => option('convert').click())
    expect(checked()).toEqual(['pinned'])
  })

  it('copies a tool under the host as a tool of its own, and opens the copy', async () => {
    mocks.directories.alice!.push(listed(convertId, {name: 'convert', type: TOOL}, 'bafyconv'))
    render(<AddExistingToolDialog input={{host}} onClose={vi.fn()} />)
    act(() => option('convert').click())
    act(() => radio('copy').click())
    expect(radioText('copy')).toContain('It never follows the original.')
    await confirm('Copy tool')
    expect(mocks.update).not.toHaveBeenCalled()
    // The copy starts as the version that was on screen.
    expect(mocks.copyInto).toHaveBeenCalledWith(host, expect.objectContaining({id: convertId.id, version: 'bafyconv'}))
    expect(mocks.success).toHaveBeenCalledWith('Copied convert')
    expect(mocks.navigate).toHaveBeenCalledWith({
      key: 'document',
      id: expect.objectContaining({path: ['weather', 'convert']}),
    })
  })

  it('narrows the list by name and description, and adds the tools search finds anywhere', () => {
    mocks.search = [
      {type: 'document', id: farId},
      // Search does not say what a document is: this one is read and found to be no tool.
      {type: 'document', id: guideId},
      {type: 'comment', id: farId},
    ]
    render(<AddExistingToolDialog input={{host}} onClose={vi.fn()} />)
    type('imperial')
    expect(names()).toEqual(['units', 'geocode'])
    expect(option('geocode').textContent).toContain('Coordinates of a place, by name.')
    mocks.search = []
    type('nothing like this')
    expect(names()).toEqual([])
    expect(container.querySelector('[role="status"]')?.textContent).toBe('No tool found by that name.')
  })

  it('takes a pasted link, and says why a link cannot be taken', () => {
    render(<AddExistingToolDialog input={{host}} onClose={vi.fn()} />)
    type(convertId.id)
    expect(names()).toEqual(['convert'])
    type(guideId.id)
    expect(container.querySelector('[role="status"]')?.textContent).toBe('That link is not a tool.')
    type(ownToolId.id)
    expect(container.querySelector('[role="status"]')?.textContent).toBe('This app already has that tool.')
    type('hm://bob/nowhere')
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Nothing is published at that link.')
  })

  it('names the settings and secrets the tool declares, and goes to the host’s settings once it is added', async () => {
    mocks.declared = {publicFields: [{name: 'mode'}], privateFields: [{name: 'datalabApiKey'}]}
    render(<AddExistingToolDialog input={{host}} onClose={vi.fn()} />)
    expect(container.querySelector('[data-testid="tool-needs"]')).toBeNull()
    act(() => option('units').click())
    expect(container.querySelector('[data-testid="tool-needs"]')?.textContent).toBe(
      'This tool reads from the app that uses it: secrets datalabApiKey; settings mode. Set them in the app’s Settings.',
    )
    await confirm('Link tool')
    expect(mocks.navigate).toHaveBeenCalledWith({
      key: 'document',
      id: expect.objectContaining({id: appId.id}),
      appView: 'settings',
    })
  })

  it('keeps the dialog open and says what went wrong when the publish fails', async () => {
    const onClose = vi.fn()
    mocks.update.mockRejectedValueOnce(new Error('Your account cannot write here'))
    render(<AddExistingToolDialog input={{host}} onClose={onClose} />)
    act(() => option('units').click())
    await confirm('Link tool')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Your account cannot write here')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('UseToolInHostDialog', () => {
  const tool = {
    id: convertId,
    document: {metadata: {name: 'convert', type: TOOL}, version: 'bafyconv', content: []} as unknown as HMDocument,
  }

  it('lists the apps and agents the person can write, and no others', () => {
    render(<UseToolInHostDialog input={{tool}} onClose={vi.fn()} />)
    // Alice's app and agent. Bob's agent is in the tool's space, but she cannot write it.
    expect(names()).toEqual(['Weather', 'Helper'])
    expect(option('Weather').textContent).toContain('App. Forecasts.')
    expect(option('Helper').textContent).toContain('Agent')
    expect(button('Link tool').disabled).toBe(true)
  })

  it('links the tool into the picked host as it is published now', async () => {
    const onClose = vi.fn()
    const current = read({name: 'Weather', type: APP}, 'v2', [card('b1', ownToolId.id)])
    mocks.request.mockResolvedValue(current)
    render(<UseToolInHostDialog input={{tool}} onClose={onClose} />)
    act(() => option('Weather').click())
    await confirm('Link tool')
    expect(mocks.request).toHaveBeenCalledWith('Resource', expect.objectContaining({id: appId.id}))
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({id: appId.id}), expect.anything())
    // Bob's tool in alice's app: pinned to the version she was looking at.
    expect(published()).toContain(`${convertId.id}?v=bafyconv`)
    expect(onClose).toHaveBeenCalled()
  })

  it('copies the tool into an agent', async () => {
    const helperId = hmId('alice', {path: ['helper']})
    mocks.request.mockResolvedValue(read({name: 'Helper', type: AGENT}))
    render(<UseToolInHostDialog input={{tool}} onClose={vi.fn()} />)
    act(() => option('Helper').click())
    act(() => radio('copy').click())
    expect(radioText('copy')).toContain('A separate tool under this agent')
    await confirm('Copy tool')
    expect(mocks.copyInto).toHaveBeenCalledWith(
      expect.objectContaining({id: expect.objectContaining({id: helperId.id})}),
      expect.objectContaining({id: convertId.id, version: 'bafyconv'}),
    )
  })

  it('says so when the person has nowhere to put the tool', () => {
    render(<UseToolInHostDialog input={{tool}} onClose={vi.fn()} />, 'dave')
    expect(names()).toEqual([])
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'You have no apps or agents yet. Create one from New, then come back.',
    )
  })
})
