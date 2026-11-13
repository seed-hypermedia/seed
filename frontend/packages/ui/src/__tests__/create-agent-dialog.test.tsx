// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {CreateAgentDialog} from '../agents/dialogs'
import {pickCreateAgentServer} from '../agents/server-picker'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  defaultServer: null as string | null,
  rememberServer: vi.fn(),
  createAgent: vi.fn(),
  createIdentity: vi.fn(),
  publish: vi.fn(),
  navigate: vi.fn(),
  onPushPublished: vi.fn(),
  findFreeAgentMountPath: vi.fn(),
  prepareAgentMount: vi.fn(),
  toastSuccess: vi.fn(),
  models: [{id: 'gpt-test', name: 'gpt-test'}] as {id: string; name: string}[],
}))

const location = hmId('alice', {path: ['notes']})
const mountId = hmId('alice', {path: ['notes', 'amber-wolf']})

vi.mock('../agents/models', () => ({
  getDefaultAgentServerUrl: () => 'http://local.test',
  isLocalAgentServer: (url: string, local: string | null) => url === local,
  describeAgentServer: (url: string, local: string | null) =>
    url === local ? 'Local app environment' : new URL(url).host,
  useRememberAgentServer: () => ({mutate: mocks.rememberServer}),
  prefetchAgentDetail: vi.fn(async () => {}),
  useAgentServerHealth: () => ({
    data: {defaultPromptUrl: 'hm://hyper.media/app-environment/guide'},
    isInitialLoading: false,
  }),
  useCreateAgent: () => ({mutateAsync: mocks.createAgent}),
  useCreateSigningIdentity: () => ({mutateAsync: mocks.createIdentity}),
  useModelProviders: () => ({data: [{name: 'openai', type: 'openai'}], isLoading: false, isFetching: false}),
  // Like the real query, no models load until a provider is named.
  useProviderModels: (_server: string, _account: string, providerName: string) => ({
    data: providerName ? mocks.models : undefined,
  }),
  useLocalAgentServerUrl: () => ({data: 'http://local.test'}),
  useAgentServerUrl: () => ({data: mocks.defaultServer}),
  useDeleteModelProvider: vi.fn(),
  useDeleteSigningIdentity: vi.fn(),
  useImportSigningIdentity: vi.fn(),
  useSaveModelProvider: vi.fn(),
  useSigningIdentities: vi.fn(),
  useUpdateSigningIdentity: vi.fn(),
}))
vi.mock('../agents/mount', () => ({
  AgentMountDestination: () => <div data-testid="choose-location" />,
  findFreeAgentMountPath: mocks.findFreeAgentMountPath,
  prepareAgentMount: mocks.prepareAgentMount,
}))
vi.mock('../agents/navigation', () => ({useNavigate: () => mocks.navigate}))
vi.mock('../agents/provider-model-select', () => ({
  ProviderModelSelect: ({value}: {value: {model: string}}) => <div data-testid="model-select">{value.model}</div>,
}))
vi.mock('../agents/prompt-editor', () => ({
  AgentPromptEditor: () => null,
  promptBlocksForRequest: (blocks: unknown) => blocks,
}))
vi.mock('@shm/shared/routing', () => ({
  useUniversalClient: () => ({publish: mocks.publish, request: vi.fn()}),
  useUniversalAppContext: () => ({onPushPublished: mocks.onPushPublished}),
}))
vi.mock('@shm/shared/models/entity', () => ({
  useResource: (id?: {id: string}) =>
    id ? {data: {type: 'document', document: {metadata: {name: 'Notes'}, path: '/notes'}}} : {data: undefined},
  useAccount: () => ({data: null}),
}))
vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: vi.fn(),
  queryClient: {},
  useQueryClient: () => ({}),
}))
vi.mock('../components/dialog', () => ({
  DialogTitle: ({children}: {children: React.ReactNode}) => <h2>{children}</h2>,
  DialogDescription: ({children}: {children: React.ReactNode}) => <p>{children}</p>,
}))
vi.mock('../select-dropdown', () => ({
  SelectDropdown: ({
    options,
    onValue,
  }: {
    options: {value: string; label: string}[]
    onValue: (value: string) => void
  }) => (
    <div>
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onValue(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
}))
vi.mock('../toast', () => ({toast: {success: mocks.toastSuccess, error: vi.fn(), promise: vi.fn()}}))
vi.mock('../universal-dialog', () => ({useAppDialog: () => ({open: vi.fn(), content: null})}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  mocks.defaultServer = null
  mocks.models = [{id: 'gpt-test', name: 'gpt-test'}]
  mocks.createIdentity.mockResolvedValue({
    _: 'CreateSigningIdentityResponse',
    identity: {name: 'amber-wolf-key', accountId: 'z6agent'},
  })
  mocks.findFreeAgentMountPath.mockResolvedValue(mountId)
  mocks.prepareAgentMount.mockResolvedValue({id: mountId.id, blobs: [{cid: 'bafy-doc', data: new Uint8Array([1])}]})
  mocks.publish.mockResolvedValue(undefined)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function button(name: string) {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === name) as
    | HTMLButtonElement
    | undefined
}

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => {})
}

function render(input: React.ComponentProps<typeof CreateAgentDialog>['input'], onClose = vi.fn()) {
  act(() => root.render(<CreateAgentDialog input={input} onClose={onClose} />))
  return onClose
}

describe('CreateAgentDialog', () => {
  it('creates the agent at a path under the location without a location step or prompt settings', async () => {
    mocks.createAgent.mockResolvedValue({_: 'CreateAgentResponse', agentId: mountId.id})
    const onClose = render({serverUrls: ['http://local.test'], selectedAccountId: 'alice', location})
    await flush()
    expect(container.textContent).toContain('"Notes"')
    // The server is stated, with the choice folded away; reasoning, thoroughness and the prompt are not offered.
    expect(container.textContent).toContain('Runs on Local')
    expect(container.textContent).not.toContain('Run on')
    expect(container.textContent).not.toContain('Reasoning')
    expect(container.textContent).not.toContain('Thoroughness')
    expect(container.textContent).not.toContain('System prompt')
    expect(button('Choose location')).toBeUndefined()

    const nameInput = container.querySelector('input') as HTMLInputElement
    const name = nameInput.value
    expect(name).not.toBe('')
    await act(async () => button('Create Agent')!.click())
    await flush()

    expect(mocks.findFreeAgentMountPath).toHaveBeenCalledWith(expect.anything(), location, name)
    expect(mocks.prepareAgentMount).toHaveBeenCalledWith(
      expect.objectContaining({accountUid: 'alice', serverUrl: 'http://local.test', to: mountId, name}),
    )
    expect(mocks.publish).toHaveBeenCalledWith({blobs: [{cid: 'bafy-doc', data: new Uint8Array([1])}]})
    expect(mocks.onPushPublished).toHaveBeenCalledWith(mountId)
    expect(mocks.createIdentity).toHaveBeenCalledWith(name)
    const request = mocks.createAgent.mock.calls[0]![0]
    expect(request.mount).toEqual({documentId: mountId.id, blobs: [{cid: 'bafy-doc', data: new Uint8Array([1])}]})
    expect(request.definition).toMatchObject({
      name,
      modelProvider: 'openai',
      model: 'gpt-test',
      signingKey: 'amber-wolf-key',
    })
    expect(request.definition.reasoningLevel).toBeUndefined()
    expect(request.definition.thoroughness).toBeUndefined()
    // The server the agent landed on is remembered, so it stays listed and is offered first next time.
    expect(mocks.rememberServer).toHaveBeenCalledWith('http://local.test')
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Agent created')
    expect(onClose).toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledWith({key: 'document', id: mountId, agentView: 'sessions'})
  })

  it('retries with the same document, identity and request after the server action fails', async () => {
    mocks.createAgent
      .mockRejectedValueOnce(new Error('Test response lost'))
      .mockResolvedValue({_: 'CreateAgentResponse', agentId: mountId.id})
    render({serverUrls: ['http://local.test'], selectedAccountId: 'alice', location})
    await flush()
    await act(async () => button('Create Agent')!.click())
    await flush()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Test response lost')
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect((container.querySelector('input') as HTMLInputElement).disabled).toBe(true)

    await act(async () => button('Retry')!.click())
    await flush()
    expect(mocks.findFreeAgentMountPath).toHaveBeenCalledTimes(1)
    expect(mocks.prepareAgentMount).toHaveBeenCalledTimes(1)
    expect(mocks.createIdentity).toHaveBeenCalledTimes(1)
    expect(mocks.publish).toHaveBeenCalledTimes(2)
    expect(mocks.createAgent).toHaveBeenCalledTimes(2)
    expect(mocks.createAgent.mock.calls[1]![0]).toBe(mocks.createAgent.mock.calls[0]![0])
    expect(mocks.navigate).toHaveBeenCalledWith({key: 'document', id: mountId, agentView: 'sessions'})
  })

  it('defaults a ChatGPT subscription agent to Sol with Astra and Luna checked', async () => {
    mocks.models = [
      {id: 'gpt-6-astra', name: 'GPT-6 Astra'},
      {id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol'},
      {id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra'},
      {id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna'},
      {id: 'gpt-5.5', name: 'GPT-5.5'},
    ]
    mocks.createAgent.mockResolvedValue({_: 'CreateAgentResponse', agentId: mountId.id})
    render({serverUrls: ['http://local.test'], selectedAccountId: 'alice', location})
    await flush()
    expect(container.querySelector('[data-testid="model-select"]')?.textContent).toBe('gpt-5.6-sol')
    await act(async () => button('Create Agent')!.click())
    await flush()
    const definition = mocks.createAgent.mock.calls[0]![0].definition
    expect(definition).toMatchObject({modelProvider: 'openai', model: 'gpt-5.6-sol'})
    expect(definition.enabledModels).toEqual([
      {provider: 'openai', model: 'gpt-6-astra'},
      {provider: 'openai', model: 'gpt-5.6-sol'},
      {provider: 'openai', model: 'gpt-5.6-luna'},
    ])
  })

  it('defaults to the configured server and folds the choice behind Change when several are configured', async () => {
    mocks.defaultServer = 'https://agents.example.com'
    render({serverUrls: ['http://local.test', 'https://agents.example.com'], selectedAccountId: 'alice', location})
    await flush()
    // The main server wins over the app's own local one, and the dropdown stays hidden.
    expect(container.textContent).toContain('Runs on agents.example.com')
    expect(container.textContent).not.toContain('Run on')
    act(() => button('Change')!.click())
    expect(container.textContent).toContain('Run on')
  })

  it('takes the URL of a server the app has never used, even when only one is offered', async () => {
    mocks.createAgent.mockResolvedValue({_: 'CreateAgentResponse', agentId: mountId.id})
    render({serverUrls: ['http://local.test'], selectedAccountId: 'alice', location})
    await flush()
    act(() => button('Change')!.click())
    act(() => button('Another server…')!.click())
    const urlInput = container.querySelector('input[aria-label="Server URL"]') as HTMLInputElement
    expect(button('Use server')!.disabled).toBe(true)
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(urlInput, 'agents.example.com')
      urlInput.dispatchEvent(new Event('input', {bubbles: true}))
    })
    act(() => button('Use server')!.click())
    // Not a URL: the picker says so and the server stays as it was.
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        urlInput,
        'https://agents.example.com/',
      )
      urlInput.dispatchEvent(new Event('input', {bubbles: true}))
    })
    act(() => button('Use server')!.click())
    await flush()
    expect(container.querySelector('input[aria-label="Server URL"]')).toBeNull()

    await act(async () => button('Create Agent')!.click())
    await flush()
    expect(mocks.prepareAgentMount).toHaveBeenCalledWith(
      expect.objectContaining({serverUrl: 'https://agents.example.com'}),
    )
    expect(mocks.rememberServer).toHaveBeenCalledWith('https://agents.example.com')
  })

  it('asks for a server URL when there is none to offer', async () => {
    render({serverUrls: [], selectedAccountId: 'alice', location})
    await flush()
    // The mocked built-in default stands in, so the choice starts stated rather than empty.
    expect(container.textContent).toContain('Runs on Local')
  })

  it('prefers the configured default, then any remote over the local server', () => {
    const local = 'http://local.test'
    expect(pickCreateAgentServer([local, 'https://a.example'], {localServerUrl: local})).toBe('https://a.example')
    expect(
      pickCreateAgentServer([local, 'https://a.example'], {
        defaultServerUrl: 'https://b.example',
        localServerUrl: local,
      }),
    ).toBe('https://a.example')
    expect(
      pickCreateAgentServer([local, 'https://a.example', 'https://b.example'], {
        defaultServerUrl: 'https://b.example',
        localServerUrl: local,
      }),
    ).toBe('https://b.example')
    expect(pickCreateAgentServer([local], {localServerUrl: local})).toBe(local)
  })

  it('still asks for a location when opened without one', async () => {
    render({serverUrls: ['http://local.test'], selectedAccountId: 'alice'})
    await flush()
    expect(button('Create Agent')).toBeUndefined()
    await act(async () => button('Choose location')!.click())
    expect(container.querySelector('[data-testid="choose-location"]')).not.toBeNull()
    expect(mocks.findFreeAgentMountPath).not.toHaveBeenCalled()
  })
})
