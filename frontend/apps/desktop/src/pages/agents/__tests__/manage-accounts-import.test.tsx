// @vitest-environment jsdom
/**
 * The agent-server accounts dialog's "Import key" flow.
 *
 * The dialog consumes the same `.hmkey.json` files that account settings and the CLI export:
 * the file is parsed and decrypted in the renderer (shared `keyfile` module) and only the raw
 * seed travels to the agent server. These tests build a real key file fixture, drive the dialog,
 * and assert what reaches the import mutation — plus the remote-server warning gating.
 */
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const LOCAL = 'http://localhost:3051'
const REMOTE = 'https://agentic.seed.hyper.media'

const mockState = vi.hoisted(() => ({
  importMutate: vi.fn(),
  /** What the local node reports as the account's profile, keyed off queryAccount. */
  resolvedProfile: null as null | {metadata?: {name?: string}},
  // Hook results must be referentially stable: the dialog derives state in effects keyed on
  // `identities.data`, and a fresh array per render would loop it forever.
  identities: {data: [] as never[], isLoading: false},
  emptyList: {data: [] as never[], isLoading: false},
  mutation: {mutateAsync: vi.fn(), mutate: vi.fn(), isLoading: false},
  localServerUrl: {data: 'http://localhost:3051'},
  health: {data: undefined},
}))

vi.mock('@/models/agents', () => ({
  DEFAULT_AGENT_SERVER_URL: 'http://localhost:3051',
  isLocalAgentServer: (serverUrl: string, localServerUrl?: string | null) =>
    !!localServerUrl && serverUrl === localServerUrl,
  useLocalAgentServerUrl: () => mockState.localServerUrl,
  prefetchAgentDetail: vi.fn(),
  useAgentServerHealth: () => mockState.health,
  useCreateAgent: () => mockState.mutation,
  useCreateSigningIdentity: () => mockState.mutation,
  useDeleteModelProvider: () => mockState.mutation,
  useDeleteSigningIdentity: () => mockState.mutation,
  useImportSigningIdentity: () => ({mutateAsync: mockState.importMutate}),
  useModelProviders: () => mockState.emptyList,
  useProviderModels: () => mockState.emptyList,
  useSaveModelProvider: () => mockState.mutation,
  useSigningIdentities: () => mockState.identities,
  useUpdateSigningIdentity: () => mockState.mutation,
}))

vi.mock('@/utils/useNavigate', () => ({useNavigate: () => vi.fn()}))
vi.mock('@shm/shared/routing', () => ({useUniversalClient: () => ({})}))
vi.mock('@shm/shared/models/queries', () => ({
  queryAccount: (_client: unknown, uid: string) => ({
    queryKey: ['test-account', uid],
    queryFn: async () => mockState.resolvedProfile,
  }),
}))
vi.mock('@shm/shared/utils/navigation', () => {
  const React = require('react')
  const NavContext = React.createContext(null)
  return {
    useNavRoute: () => ({key: 'library'}),
    useNavigation: () => ({state: {}, dispatch: vi.fn()}),
    NavContextProvider: NavContext.Provider,
    navStateReducer: (state: unknown) => state,
    getRouteKey: () => 'library',
    appRouteOfId: () => undefined,
    isHttpUrl: () => false,
    useNavigate: () => vi.fn(),
    useNavigationState: () => ({}),
    useNavigationDispatch: () => vi.fn(),
    useRouteDocId: () => null,
  }
})
vi.mock('@shm/shared/models/entity', () => ({
  useAccount: () => ({data: undefined}),
  useResource: () => ({data: undefined}),
}))
vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/grpc-client', () => ({grpcClient: {}}))
// The prompt editor drags in the ProseMirror stack, which does not load under jsdom; the accounts
// dialog never renders it.
vi.mock('@/pages/agents/prompt-editor', () => ({
  AgentPromptEditor: () => null,
  promptBlocksForRequest: vi.fn(),
  promptBlocksToMarkdown: vi.fn(() => ''),
}))

import {keyfile} from '@seed-hypermedia/client'
import * as blobs from '@shm/shared/blobs'
import {Dialog, DialogContent} from '@shm/ui/components/dialog'
import {ManageAgentAccountsDialog} from '../dialogs'

let container: HTMLDivElement
let root: Root

/**
 * The dialog content normally lives inside useAppDialog's Dialog root; the test provides it.
 * Non-modal, because the nested ImportKeyDialog is a second modal and two stacked focus traps
 * loop forever under jsdom (they coexist fine in a real browser).
 */
function render(element: React.ReactElement) {
  act(() =>
    root.render(
      <Dialog open modal={false}>
        <DialogContent>{element}</DialogContent>
      </Dialog>,
    ),
  )
}

function click(element: Element | null | undefined) {
  act(() => element?.dispatchEvent(new MouseEvent('click', {bubbles: true})))
}

function buttonWithText(text: string) {
  return Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes(text))
}

/** jsdom's File lacks Blob.text(); real renderers (Chromium) have it. */
function makeFile(content: string, name: string): File {
  const file = new File([content], name, {type: 'application/json'})
  if (typeof file.text !== 'function') Object.defineProperty(file, 'text', {value: async () => content})
  return file
}

/** A genuine unencrypted `.hmkey.json` payload, as the CLI and account settings export it. */
async function makeKeyFileFixture() {
  const pair = blobs.generateNobleKeyPair()
  const publicKey = blobs.principalToString(pair.principal)
  const payload = await keyfile.create({publicKey, key: pair.seed, profile: {name: 'Eric'}})
  const file = makeFile(keyfile.stringify(payload), `${publicKey}.hmkey.json`)
  return {file, publicKey, seed: pair.seed}
}

async function chooseFile(file: File) {
  const input = document.getElementById('agent-import-key-file') as HTMLInputElement
  expect(input).toBeTruthy()
  Object.defineProperty(input, 'files', {value: [file], configurable: true})
  await act(async () => {
    input.dispatchEvent(new Event('change', {bubbles: true}))
  })
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  mockState.importMutate = vi.fn(async () => ({label: 'Eric', accountId: 'z-imported'}))
  mockState.resolvedProfile = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

describe('agent accounts import key', () => {
  it('imports a real key file: decrypts locally and sends only the seed, labeled from the profile', async () => {
    const {file, seed} = await makeKeyFileFixture()
    render(<ManageAgentAccountsDialog input={{serverUrl: LOCAL, selectedAccountId: 'account-1'}} onClose={() => {}} />)

    click(buttonWithText('Import key'))
    await chooseFile(file)
    await act(async () => {
      buttonWithText('Import Key')
        ?.closest('form')
        ?.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
      // The submit handler parses the file and awaits the mutation.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // Surfacing the dialog's inline error makes a failure here self-explanatory.
    expect(document.body.querySelector('p.text-destructive')?.textContent ?? '').toBe('')
    expect(mockState.importMutate).toHaveBeenCalledTimes(1)
    const sent = mockState.importMutate.mock.calls[0]![0] as {seed: Uint8Array; label?: string}
    expect(sent.label).toBe('Eric')
    expect(Array.from(sent.seed)).toEqual(Array.from(seed))
  })

  it('labels the import from the local profile when the key file carries no name — never invents one', async () => {
    // CLI and daemon exports omit the profile block; the account's real name must come from the
    // local node, and if it cannot, no label is sent at all (the profile is never renamed).
    const pair = blobs.generateNobleKeyPair()
    const publicKey = blobs.principalToString(pair.principal)
    const payload = await keyfile.create({publicKey, key: pair.seed})
    const file = makeFile(keyfile.stringify(payload), `${publicKey}.hmkey.json`)
    mockState.resolvedProfile = {metadata: {name: 'Eric Vicenti'}}
    render(<ManageAgentAccountsDialog input={{serverUrl: LOCAL, selectedAccountId: 'account-1'}} onClose={() => {}} />)

    click(buttonWithText('Import key'))
    await chooseFile(file)
    await act(async () => {
      buttonWithText('Import Key')
        ?.closest('form')
        ?.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(document.body.querySelector('p.text-destructive')?.textContent ?? '').toBe('')
    expect(mockState.importMutate).toHaveBeenCalledTimes(1)
    const sent = mockState.importMutate.mock.calls[0]![0] as {label?: string}
    expect(sent.label).toBe('Eric Vicenti')
  })

  it('shows no key-transfer warning for the local server', async () => {
    render(<ManageAgentAccountsDialog input={{serverUrl: LOCAL, selectedAccountId: 'account-1'}} onClose={() => {}} />)
    click(buttonWithText('Import key'))
    expect(document.body.textContent).not.toContain('secret key')
  })

  it('warns that the key will be sent to a remote server, naming its host', async () => {
    render(<ManageAgentAccountsDialog input={{serverUrl: REMOTE, selectedAccountId: 'account-1'}} onClose={() => {}} />)
    click(buttonWithText('Import key'))
    expect(document.body.textContent).toContain("send the account's secret key")
    expect(document.body.textContent).toContain('agentic.seed.hyper.media')
    expect(document.body.textContent).toContain('full control')
  })

  it('rejects a file that is not a .hmkey.json export', async () => {
    render(<ManageAgentAccountsDialog input={{serverUrl: LOCAL, selectedAccountId: 'account-1'}} onClose={() => {}} />)
    click(buttonWithText('Import key'))
    await chooseFile(makeFile('{}', 'not-a-key.json'))
    await act(async () => {
      buttonWithText('Import Key')
        ?.closest('form')
        ?.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(mockState.importMutate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Key file must end with .hmkey.json')
  })
})
