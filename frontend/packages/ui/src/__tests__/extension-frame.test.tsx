// @vitest-environment jsdom
import type {ExtensionManifest, ExtensionMount} from '@seed-hypermedia/client/extensions'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ExtensionFrame} from '../extensions/extension-frame'
import {ExtensionHostProvider, type ExtensionHostAdapter} from '../extensions/extension-host-context'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@shm/shared/routing', () => ({
  useUniversalAppContext: () => ({}),
  useUniversalClient: () => ({request: vi.fn(), publish: vi.fn()}),
}))

vi.mock('../extensions/sign-confirm-dialog', () => ({
  useSignConfirmDialog: () => ({confirmSign: vi.fn(), content: null}),
}))

const SITE_UID = 'z6MkpTHzQyPsLa6Vn2XZbbvDQZmyAkgMSjT8fMXk1NoMFSGh'
const ENTRY_CID = 'bafkreientry'
const manifest: ExtensionManifest = {
  manifestVersion: 1,
  kind: 'page',
  version: '1.0.0',
  entry: `ipfs://${ENTRY_CID}`,
  permissions: [],
}
const mount: ExtensionMount & {subPath: string[]} = {
  mountPath: 'board',
  mountSegments: ['board'],
  record: {ext: 'hm://z6MkAuthor/kanban'},
  subPath: [],
}
const docId = {uid: SITE_UID, path: ['board'], id: `hm://${SITE_UID}/board`} as unknown as UnpackedHypermediaId

function makeAdapter(overrides: Partial<ExtensionHostAdapter> = {}): ExtensionHostAdapter {
  return {
    platform: 'web',
    user: null,
    theme: 'light',
    fetchEntryHtml: vi.fn(async () => '<html><body>ext</body></html>'),
    fileUrl: (cid) => `/hm/api/file/${cid}`,
    readFile: async () => ({bytes: new Uint8Array()}),
    navigate: vi.fn(),
    openExternal: vi.fn(),
    setRoute: vi.fn(),
    toast: vi.fn(),
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

async function render(adapter: ExtensionHostAdapter, props: {devUrl?: string | null; query?: Record<string, string>}) {
  await act(async () => {
    root.render(
      <ExtensionHostProvider adapter={adapter}>
        <ExtensionFrame
          extensionId="hm://z6MkAuthor/kanban"
          extensionVersion="bafyExt"
          extensionName="Kanban"
          manifest={manifest}
          mount={mount}
          siteUid={SITE_UID}
          docId={docId}
          query={props.query}
          devUrl={props.devUrl}
        />
      </ExtensionHostProvider>,
    )
  })
}

function iframe(): HTMLIFrameElement | null {
  return container.querySelector('[data-testid="extension-iframe"]')
}

describe('ExtensionFrame entry loading', () => {
  it('does not refetch or remount the iframe when the host rebuilds its adapter', async () => {
    const first = makeAdapter()
    await render(first, {})
    expect(first.fetchEntryHtml).toHaveBeenCalledTimes(1)
    expect(first.fetchEntryHtml).toHaveBeenCalledWith(ENTRY_CID)
    const el = iframe()
    expect(el).not.toBeNull()
    expect(el?.getAttribute('srcdoc')).toContain('ext')

    // Host re-renders with a new adapter object (sign-in, theme, in-mount
    // navigation): a new fetchEntryHtml closure and a changed user/theme.
    const second = makeAdapter({user: {accountId: SITE_UID, name: 'Alice'}, theme: 'dark'})
    await render(second, {query: {card: '1'}})
    expect(second.fetchEntryHtml).not.toHaveBeenCalled()
    expect(first.fetchEntryHtml).toHaveBeenCalledTimes(1)
    expect(iframe()).toBe(el)

    // Route props alone do not reload either.
    await render(second, {query: {card: '2'}})
    expect(iframe()).toBe(el)
  })

  it('reloads only when the code source changes (dev override on/off)', async () => {
    const adapter = makeAdapter()
    await render(adapter, {})
    const published = iframe()
    expect(published?.getAttribute('srcdoc')).toBeTruthy()

    await render(adapter, {devUrl: 'http://localhost:5181/'})
    const dev = iframe()
    expect(dev).not.toBe(published)
    expect(dev?.getAttribute('src')).toBe('http://localhost:5181/')
    expect(dev?.getAttribute('srcdoc')).toBeNull()
    expect(container.querySelector('[data-testid="extension-dev-banner"]')).not.toBeNull()
    // Switching to the override needs no entry fetch.
    expect(adapter.fetchEntryHtml).toHaveBeenCalledTimes(1)

    // Clearing the override goes back to the published entry (fetched again).
    await render(adapter, {devUrl: null})
    expect(adapter.fetchEntryHtml).toHaveBeenCalledTimes(2)
    expect(iframe()).not.toBe(dev)
    expect(iframe()?.getAttribute('srcdoc')).toBeTruthy()
  })

  it('shows the entry error and retries', async () => {
    const adapter = makeAdapter({fetchEntryHtml: vi.fn(async () => Promise.reject(new Error('boom')))})
    await render(adapter, {})
    expect(iframe()).toBeNull()
    expect(container.textContent).toContain('boom')
    ;(adapter.fetchEntryHtml as ReturnType<typeof vi.fn>).mockImplementation(async () => '<html></html>')
    const retry = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Retry')
    expect(retry).toBeDefined()
    await act(async () => {
      retry!.click()
    })
    expect(adapter.fetchEntryHtml).toHaveBeenCalledTimes(2)
    expect(iframe()).not.toBeNull()
  })
})
