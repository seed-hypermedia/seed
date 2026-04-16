import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const {getProviderQueryMock} = vi.hoisted(() => ({
  getProviderQueryMock: vi.fn(),
}))

const dialogOpenMock = vi.fn()
const addProviderMutateMock = vi.fn()
const deleteProviderMutateMock = vi.fn()
const duplicateProviderMutateMock = vi.fn()
const setSelectedProviderMutateMock = vi.fn()
const startOpenaiLoginMutateMock = vi.fn()
const openUrlMock = vi.fn()
const updateProviderMutateMock = vi.fn()

let mockAnthropicModels: string[] = []
let mockGeminiModels: string[] = []
let mockProviders: Array<Record<string, any>> = []
let mockOllamaModels: string[] = []
let mockOpenAIModels: string[] = []
let mockSelectedProvider: Record<string, any> | null = null
let mockOpenaiLoginStatus: Record<string, any> | null = null

vi.mock('@/models/ai-config', () => ({
  useAIProviders: () => ({data: mockProviders}),
  useDeleteProvider: () => ({mutate: deleteProviderMutateMock}),
  useDuplicateProvider: () => ({mutate: duplicateProviderMutateMock}),
  useSelectedProvider: () => ({data: mockSelectedProvider}),
  useSetSelectedProvider: () => ({mutate: setSelectedProviderMutateMock}),
  useAddProvider: () => ({isLoading: false, mutate: addProviderMutateMock}),
  useAnthropicModels: () => ({data: mockAnthropicModels, isFetching: false}),
  useGeminiModels: () => ({data: mockGeminiModels, isFetching: false, refetch: vi.fn()}),
  useOllamaModels: () => ({data: mockOllamaModels, isFetching: false, isLoading: false}),
  useOpenaiLoginStatus: (sessionId: string | null) => ({data: sessionId ? mockOpenaiLoginStatus : null}),
  useOpenAIModels: () => ({data: mockOpenAIModels, isFetching: false, refetch: vi.fn()}),
  useOpenAIModelsForProvider: () => ({data: [], isFetching: false, refetch: vi.fn().mockResolvedValue(undefined)}),
  useStartOpenaiLogin: () => ({isLoading: false, mutate: startOpenaiLoginMutateMock}),
  useUpdateProvider: () => ({isLoading: false, mutate: updateProviderMutateMock}),
}))

vi.mock('@shm/ui/universal-dialog', async () => {
  const React = await import('react')

  return {
    useAppDialog: (DialogComponent: any) => {
      const [input, setInput] = React.useState<string | null>(null)

      return {
        open: (nextInput: string) => {
          dialogOpenMock(nextInput)
          setInput(nextInput)
        },
        close: () => setInput(null),
        content: input
          ? React.createElement(
              'div',
              {'data-testid': 'dialog-content'},
              React.createElement(DialogComponent, {input, onClose: () => setInput(null)}),
            )
          : null,
      }
    },
  }
})

vi.mock('@/open-url', () => ({
  useOpenUrl: () => openUrlMock,
}))

vi.mock('@shm/ui/components/dialog', async () => {
  const React = await import('react')

  return {
    DialogDescription: ({children}: any) => React.createElement('div', null, children),
    DialogTitle: ({children}: any) => React.createElement('div', null, children),
  }
})

vi.mock('@shm/ui/form-fields', async () => {
  const React = await import('react')

  return {
    Field: ({children, label}: any) =>
      React.createElement('label', null, label ? React.createElement('span', null, label) : null, children),
  }
})

vi.mock('@/trpc', () => ({
  client: {
    aiConfig: {
      getProvider: {query: getProviderQueryMock},
    },
  },
}))

vi.mock('@sentry/electron', () => ({}))
vi.mock('@sentry/electron/main', () => ({}))
vi.mock('@sentry/electron/renderer', () => ({}))
vi.mock('@sentry/electron/preload', () => ({}))

import {AIProvidersSettings} from '../pages/settings'

function renderSettings() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AIProvidersSettings />
      </QueryClientProvider>,
    )
  })

  return {container, root, queryClient}
}

function cleanupRendered(root: Root, container: HTMLDivElement, queryClient: QueryClient) {
  act(() => {
    root.unmount()
  })
  queryClient.clear()
  container.remove()
}

function findButton(container: HTMLDivElement, label: string) {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(label)) as
    | HTMLButtonElement
    | undefined
}

function findButtonExact(container: HTMLDivElement, label: string) {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === label) as
    | HTMLButtonElement
    | undefined
}

function findDialog(container: HTMLDivElement) {
  return container.querySelector('[data-testid="dialog-content"]') as HTMLDivElement | null
}

function findProviderNameInput(container: HTMLDivElement) {
  return container.querySelector('input[placeholder="Provider name"]') as HTMLInputElement | null
}

function findInputByPlaceholder(container: HTMLDivElement, placeholder: string) {
  return container.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement | null
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  valueSetter?.call(input, value)
  input.dispatchEvent(new Event('input', {bubbles: true}))
  input.dispatchEvent(new Event('change', {bubbles: true}))
}

async function waitForProviderNameValue(container: HTMLDivElement, value: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const input = findProviderNameInput(container)
    if (input?.value === value) return

    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function waitForText(container: HTMLDivElement, value: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (container.textContent?.includes(value)) return

    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function waitForCondition(predicate: () => boolean) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (predicate()) return

    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

describe('AIProvidersSettings', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    mockAnthropicModels = []
    mockGeminiModels = []
    mockProviders = []
    mockOllamaModels = []
    mockOpenAIModels = []
    mockSelectedProvider = null
    mockOpenaiLoginStatus = null
    addProviderMutateMock.mockReset()
    dialogOpenMock.mockReset()
    deleteProviderMutateMock.mockReset()
    duplicateProviderMutateMock.mockReset()
    getProviderQueryMock.mockReset()
    setSelectedProviderMutateMock.mockReset()
    startOpenaiLoginMutateMock.mockReset()
    openUrlMock.mockReset()
    updateProviderMutateMock.mockReset()
    getProviderQueryMock.mockImplementation((providerId: string) => {
      return mockProviders.find((provider) => provider.id === providerId) || null
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows only the setup overview when no providers exist and opens the add dialog for the selected provider type', () => {
    const {container, root, queryClient} = renderSettings()

    expect(container.textContent).toContain('Agent Assistant Providers')
    expect(container.textContent).toContain('Set up the assistant with a model provider.')
    expect(container.textContent).not.toContain('Configured Providers')
    expect(findButton(container, 'Add Provider')).toBeUndefined()

    const anthropicButton = findButton(container, 'Anthropic')
    expect(anthropicButton).toBeDefined()

    act(() => {
      anthropicButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    expect(dialogOpenMock).toHaveBeenCalledWith('anthropic')

    cleanupRendered(root, container, queryClient)
  })

  it('keeps a provider selected in the configured-provider view and uses the same add-provider dialog', () => {
    mockProviders = [
      {
        id: 'provider-1',
        label: 'OpenAI',
        type: 'openai',
        model: 'gpt-5',
        authMode: 'login',
        openaiAuth: {email: 'test@example.com'},
      },
    ]
    mockSelectedProvider = mockProviders[0]

    const {container, root, queryClient} = renderSettings()

    expect(container.textContent).toContain('Agent Assistant Providers')
    expect(container.textContent).toContain('Configured Providers')
    expect(container.textContent).not.toContain('Select a provider to edit or start a new one.')
    expect(getProviderQueryMock).toHaveBeenCalledWith('provider-1')

    const addButton = findButton(container, 'Add Provider')
    expect(addButton).toBeDefined()
    act(() => {
      addButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    expect(dialogOpenMock).toHaveBeenCalledWith('choose')
    expect(container.textContent).toContain('Add Provider')
    expect(container.textContent).toContain('Choose a provider and complete the remaining details here.')
    expect(container.textContent).toContain('Gemini')
    expect(container.textContent).toContain('Anthropic')
    expect(container.textContent).toContain('Ollama')

    cleanupRendered(root, container, queryClient)
  })

  it('waits to show model selection in the add flow until the provider connection is confirmed', async () => {
    mockOpenAIModels = ['gpt-5']
    addProviderMutateMock.mockImplementation((_input, options) => {
      options?.onSuccess?.()
    })

    const {container, root, queryClient} = renderSettings()

    await act(async () => {
      findButton(container, 'OpenAI')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    await act(async () => {
      findButton(container, 'API Key')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(container.textContent).not.toContain('Choose the OpenAI model this provider should use.')
    expect(findButtonExact(container, 'Add Provider')).toBeUndefined()

    const apiKeyInput = findInputByPlaceholder(container, 'sk-...')
    expect(apiKeyInput).toBeDefined()

    await act(async () => {
      if (apiKeyInput) {
        setInputValue(apiKeyInput, 'sk-test-openai-key')
      }
    })

    await waitForText(container, 'Choose the OpenAI model this provider should use.')
    expect(container.textContent).toContain('Choose the OpenAI model this provider should use.')
    expect(findButtonExact(container, 'Add Provider')).toBeDefined()
    expect(findProviderNameInput(container)).toBeNull()

    await act(async () => {
      findButtonExact(container, 'Add Provider')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(addProviderMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'OpenAI - gpt-5',
        type: 'openai',
      }),
      expect.anything(),
    )

    cleanupRendered(root, container, queryClient)
  })

  it('confirms Gemini providers with a live model list before enabling model selection', async () => {
    mockGeminiModels = ['gemini-2.5-flash']
    addProviderMutateMock.mockImplementation((_input, options) => {
      options?.onSuccess?.()
    })

    const {container, root, queryClient} = renderSettings()

    await act(async () => {
      findButton(container, 'Gemini')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(container.textContent).not.toContain('Choose the Gemini model this provider should use.')

    const apiKeyInput = findInputByPlaceholder(container, 'AIza...')
    expect(apiKeyInput).toBeDefined()

    await act(async () => {
      if (apiKeyInput) {
        setInputValue(apiKeyInput, 'AIza-test-gemini-key')
      }
    })

    await waitForText(container, 'Choose the Gemini model this provider should use.')
    expect(findButtonExact(container, 'Add Provider')).toBeDefined()

    await act(async () => {
      findButtonExact(container, 'Add Provider')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(addProviderMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Gemini - gemini-2.5-flash',
        type: 'gemini',
      }),
      expect.anything(),
    )

    cleanupRendered(root, container, queryClient)
  })

  it('updates the edit form when a different provider is selected', async () => {
    mockProviders = [
      {
        id: 'provider-1',
        label: 'Alpha Provider',
        type: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: 'alpha-key',
      },
      {
        id: 'provider-2',
        label: 'Beta Provider',
        type: 'anthropic',
        model: 'claude-opus-4-20250514',
        apiKey: 'beta-key',
      },
    ]
    mockSelectedProvider = mockProviders[0]

    const {container, root, queryClient} = renderSettings()

    await waitForProviderNameValue(container, 'Alpha Provider')
    expect(findProviderNameInput(container)?.value).toBe('Alpha Provider')

    await act(async () => {
      findButton(container, 'Beta Provider')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })

    await waitForProviderNameValue(container, 'Beta Provider')
    expect(getProviderQueryMock).toHaveBeenCalledWith('provider-2')
    expect(findProviderNameInput(container)?.value).toBe('Beta Provider')

    cleanupRendered(root, container, queryClient)
  })

  it('hides the type picker and autosaves label and model changes in selected provider settings', async () => {
    mockProviders = [
      {
        id: 'provider-1',
        label: 'Local Server',
        type: 'ollama',
        model: 'llama3',
        baseUrl: 'http://localhost:11434',
      },
    ]
    mockSelectedProvider = mockProviders[0]
    updateProviderMutateMock.mockImplementation((_input, options) => {
      options?.onSuccess?.()
    })

    const {container, root, queryClient} = renderSettings()

    await waitForProviderNameValue(container, 'Local Server')
    expect(findButtonExact(container, 'Save')).toBeUndefined()
    expect(findButtonExact(container, 'OpenAI')).toBeUndefined()
    expect(findButtonExact(container, 'Gemini')).toBeUndefined()
    expect(findButtonExact(container, 'Anthropic')).toBeUndefined()
    expect(findButtonExact(container, 'Ollama')).toBeUndefined()

    const labelInput = findProviderNameInput(container)
    const modelInput = findInputByPlaceholder(container, 'e.g. llama3')
    expect(labelInput).toBeDefined()
    expect(modelInput).toBeDefined()

    await act(async () => {
      if (labelInput) {
        setInputValue(labelInput, 'Studio Ollama')
      }
    })

    await waitForCondition(() => updateProviderMutateMock.mock.calls.some(([input]) => input.label === 'Studio Ollama'))

    await act(async () => {
      if (modelInput) {
        setInputValue(modelInput, 'llama3.2')
      }
    })

    await waitForCondition(() => updateProviderMutateMock.mock.calls.some(([input]) => input.model === 'llama3.2'))

    cleanupRendered(root, container, queryClient)
  })

  it('hides the provider type selector when the add dialog opens for a specific provider', async () => {
    const {container, root, queryClient} = renderSettings()

    await act(async () => {
      findButton(container, 'Add Provider')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    const openaiButton = findButton(container, 'OpenAI')
    expect(openaiButton).toBeDefined()

    await act(async () => {
      openaiButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    const dialog = findDialog(container)
    expect(dialog?.textContent).toContain('Add OpenAI Provider')
    expect(dialog?.textContent).toContain('Complete the remaining provider details here.')
    expect(dialog?.textContent).not.toContain('Gemini')
    expect(dialog?.textContent).not.toContain('Anthropic')
    expect(dialog?.textContent).not.toContain('Ollama')
    expect(findProviderNameInput(container)).toBeNull()

    cleanupRendered(root, container, queryClient)
  })

  it('waits for an explicit OpenAI auth mode selection and lets the user revert to the chooser', async () => {
    const {container, root, queryClient} = renderSettings()

    await act(async () => {
      findButton(container, 'Add Provider')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    const openaiButton = findButton(container, 'OpenAI')
    expect(openaiButton).toBeDefined()

    await act(async () => {
      openaiButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(findButtonExact(container, 'Start ChatGPT Pro Sign In')).toBeUndefined()

    const authModeButton = findButton(container, 'ChatGPT Pro Sign In')
    expect(authModeButton).toBeDefined()

    await act(async () => {
      authModeButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(findButtonExact(container, 'Start ChatGPT Pro Sign In')).toBeDefined()
    expect(findButtonExact(container, 'Cancel')).toBeDefined()

    await act(async () => {
      findButtonExact(container, 'Cancel')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(findButtonExact(container, 'Start ChatGPT Pro Sign In')).toBeUndefined()
    expect(findButton(container, 'ChatGPT Pro Sign In')).toBeDefined()

    cleanupRendered(root, container, queryClient)
  })

  it('shows a retry action when ChatGPT Pro sign-in fails and restarts the flow', async () => {
    mockOpenaiLoginStatus = {
      status: 'error',
      message: 'fetch failed',
    }
    startOpenaiLoginMutateMock.mockImplementation((_input, options) => {
      options?.onSuccess?.({
        sessionId: `session-${startOpenaiLoginMutateMock.mock.calls.length}`,
        authUrl: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-EFGH',
        providerId: null,
      })
    })

    const {container, root, queryClient} = renderSettings()

    await act(async () => {
      findButton(container, 'Add Provider')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    const openaiButton = findButton(container, 'OpenAI')
    expect(openaiButton).toBeDefined()

    await act(async () => {
      openaiButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    await act(async () => {
      findButton(container, 'ChatGPT Pro Sign In')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    const startButton = findButtonExact(container, 'Start ChatGPT Pro Sign In')
    expect(startButton).toBeDefined()

    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(startOpenaiLoginMutateMock).toHaveBeenCalledTimes(1)
    expect(openUrlMock).toHaveBeenCalledWith('https://auth.openai.com/codex/device')
    expect(container.textContent).toContain('fetch failed')

    const retryButton = findButton(container, 'Retry sign in')
    expect(retryButton).toBeDefined()

    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(startOpenaiLoginMutateMock).toHaveBeenCalledTimes(2)

    cleanupRendered(root, container, queryClient)
  })

  it('closes the add dialog and selects the new provider when ChatGPT Pro sign-in completes', async () => {
    mockProviders = [
      {
        id: 'provider-1',
        label: 'Existing Provider',
        type: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: 'existing-key',
      },
    ]
    mockSelectedProvider = mockProviders[0]
    mockOpenaiLoginStatus = {
      status: 'success',
      providerId: 'provider-2',
      email: 'test@example.com',
    }
    startOpenaiLoginMutateMock.mockImplementation((_input, options) => {
      mockProviders = [
        ...mockProviders,
        {
          id: 'provider-2',
          label: 'OpenAI - gpt-5',
          type: 'openai',
          model: 'gpt-5',
          authMode: 'login',
          openaiAuth: {email: 'test@example.com'},
        },
      ]
      options?.onSuccess?.({
        sessionId: 'session-success',
        authUrl: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-EFGH',
        providerId: 'provider-2',
      })
    })

    const {container, root, queryClient} = renderSettings()

    await act(async () => {
      findButton(container, 'Add Provider')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    const openaiButton = findButton(container, 'OpenAI')
    expect(openaiButton).toBeDefined()

    await act(async () => {
      openaiButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Add Provider')

    await act(async () => {
      findButton(container, 'ChatGPT Pro Sign In')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    const startButton = findButtonExact(container, 'Start ChatGPT Pro Sign In')
    expect(startButton).toBeDefined()

    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(openUrlMock).toHaveBeenCalledWith('https://auth.openai.com/codex/device')
    expect(container.textContent).not.toContain('Add OpenAI Provider')
    expect(findProviderNameInput(container)?.value).toBe('Existing Provider')
    expect(getProviderQueryMock).toHaveBeenCalledWith('provider-1')

    cleanupRendered(root, container, queryClient)
  })
})
