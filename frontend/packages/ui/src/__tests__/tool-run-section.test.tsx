// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {runProgressText, ToolRunSection} from '../apps/running'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const appId = hmId('alice', {path: ['weather']})
const toolId = hmId('alice', {path: ['weather', 'forecast']})

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  navigate: vi.fn(),
  schema: undefined as unknown,
  test: {output: {temp: 30}, durationMs: 7, logs: 'looked up Lisbon'} as Record<string, unknown>,
  health: {status: 'ok', uptime: 1} as Record<string, unknown>,
}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavigate: () => mocks.navigate}))
vi.mock('../hm-icon', () => ({HMIcon: () => null}))
vi.mock('@shm/shared/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/routing')>()),
  useUniversalAppContext: () => ({selectedIdentity: {get: () => 'alice', subscribe: () => () => {}}}),
}))
vi.mock('@shm/shared/use-stream', () => ({useStream: (stream: {get: () => unknown}) => stream?.get()}))
vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: undefined, isInitialLoading: false}),
  useAccount: () => ({data: {metadata: {name: 'Alice'}}}),
}))
vi.mock('../agents/client', () => ({sendAgentAction: mocks.send, getAgentServerHealth: async () => mocks.health}))
// The viewer's own app environment, where a tool in no app runs.
vi.mock('../agents/server-picker', () => ({
  useOwnAppServerUrl: () => ({serverUrl: 'http://mine.test', isLoading: false}),
}))
vi.mock('../schema/schema-resolve', () => ({
  useResolvedSchema: () => ({schema: mocks.schema, registry: {}, isLoading: false}),
}))
vi.mock('../toast', () => ({toast: {success: vi.fn(), error: vi.fn()}}))

const app = {
  metadata: {name: 'Weather', type: 'hm://hyper.media/app', appEnvironmentUrl: 'http://apps.test'},
} as unknown as HMDocument

// jsdom has no ResizeObserver, which the optional-field switch measures itself with.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.send.mockReset()
  mocks.health = {status: 'ok', uptime: 1}
  mocks.schema = {
    type: 'hm://hyper.media/struct',
    properties: {city: {value: {type: 'hm://hyper.media/string'}, required: true}},
  }
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(
  running: boolean,
  output: unknown = {temp: 21},
  extra: Partial<React.ComponentProps<typeof ToolRunSection>> = {},
) {
  mocks.send.mockImplementation(async ({action}: {action: {_: string}}) => {
    if (action._ === 'TestAppTool') return {test: mocks.test}
    if (action._ === 'GetAppRun') return {run: running ? {appId: appId.id, privateConfigKeys: []} : null}
    if (action._ === 'ListAppToolCalls')
      return {
        calls: [
          {
            id: 'old',
            appId: appId.id,
            toolId: toolId.id,
            caller: 'z6MkAliceAliceAliceAliceAliceAliceAlice',
            input: {city: 'Porto'},
            output: {},
            createdAt: 1,
          },
        ],
      }
    if (action._ === 'CallAppTool')
      return {
        call: {
          id: 'c1',
          appId: appId.id,
          toolId: toolId.id,
          caller: 'alice',
          input: {city: 'Lisbon'},
          output,
          durationMs: 5,
          createdAt: 1,
        },
      }
    throw new Error(`unexpected ${action._}`)
  })
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ToolRunSection
          appId={appId}
          app={app}
          toolId={toolId}
          inputSchemaRef="ipfs://schema"
          onOpenSettings={() => {}}
          {...extra}
        />
      </QueryClientProvider>,
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

describe('ToolRunSection', () => {
  it('lets someone who cannot write the tool call it while its app runs, and lists the calls made', async () => {
    await render(true)
    const input = container.querySelector<HTMLInputElement>('input[aria-label="city"]')
    expect(input).not.toBeNull()
    const run = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Run'))
    expect(run).toBeDefined()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'Lisbon')
      input!.dispatchEvent(new Event('input', {bubbles: true}))
    })
    await act(async () => {
      run!.click()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({action: expect.objectContaining({_: 'CallAppTool', input: {city: 'Lisbon'}})}),
    )
    expect(container.textContent).toContain('Succeeded')
    expect(container.textContent).toContain('21')
    // The calls made so far, by anyone, show who made them and open as their own page.
    expect(container.textContent).toContain('What apps, agents and other callers ran')
    expect(container.textContent).toContain('city: Porto')
    expect(container.textContent).toContain('Alice')
    const row = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('city: Porto'))
    await act(async () => row!.click())
    expect(mocks.navigate).toHaveBeenCalledWith({key: 'document', id: toolId, toolCallId: 'old'})
  })

  it('draws a list of objects as typed rows, and sends a real list', async () => {
    mocks.schema = {
      type: 'hm://hyper.media/struct',
      properties: {
        ingredients: {
          required: true,
          value: {
            type: 'hm://hyper.media/list',
            items: {
              type: 'hm://hyper.media/struct',
              properties: {
                name: {value: {type: 'hm://hyper.media/string'}, required: true},
                amount: {value: {type: 'hm://hyper.media/float'}},
              },
            },
          },
        },
      },
    }
    await render(true)
    const button = (text: string) =>
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)!
    await act(async () => button('+ item').click())
    const name = container.querySelector<HTMLInputElement>('input[aria-label="name"]')!
    expect(name).not.toBeNull()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'flour')
      name.dispatchEvent(new Event('input', {bubbles: true}))
    })
    await act(async () => {
      button('Run').click()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({_: 'CallAppTool', input: {ingredients: [{name: 'flour'}]}}),
      }),
    )
  })

  it('takes a file for a file field, sends it inside the input, and offers returned files for saving', async () => {
    const fileSchema = {
      type: 'hm://hyper.media/struct',
      properties: {
        name: {value: {type: 'hm://hyper.media/string'}, required: true},
        mimeType: {value: {type: 'hm://hyper.media/string'}, required: true},
        data: {value: {type: 'hm://hyper.media/string'}, required: true},
      },
    }
    mocks.schema = {
      type: 'hm://hyper.media/struct',
      properties: {
        file: {required: true, value: fileSchema},
        mode: {value: {type: 'hm://hyper.media/string'}},
      },
    }
    Object.assign(URL, {createObjectURL: () => 'blob:returned-file', revokeObjectURL: () => {}})
    const returned = {name: 'assets/figure.png', mimeType: 'image/png', data: btoa('PNG bytes')}
    await render(true, {pages: 2, figure: returned})
    const button = (text: string) =>
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)!
    // The file's three fields are one picker, not three text boxes.
    expect(container.querySelector('input[aria-label="data"]')).toBeNull()
    expect(container.querySelector('input[aria-label="mimeType"]')).toBeNull()
    const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(picker).not.toBeNull()
    expect(container.textContent).toContain('No file chosen')
    // Run waits for a file.
    expect((button('Run') as HTMLButtonElement).disabled).toBe(true)

    const picked = new File(['hello'], 'paper.pdf', {type: 'application/pdf'})
    await act(async () => {
      Object.defineProperty(picker, 'files', {value: [picked], configurable: true})
      picker.dispatchEvent(new Event('change', {bubbles: true}))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(container.textContent).toContain('paper.pdf')
    expect(container.textContent).toContain('application/pdf · 5 B')
    expect((button('Run') as HTMLButtonElement).disabled).toBe(false)
    await act(async () => {
      button('Run').click()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          _: 'CallAppTool',
          input: {file: {name: 'paper.pdf', mimeType: 'application/pdf', data: btoa('hello')}},
        }),
      }),
    )
    // The result names the returned file and its size, shows none of its bytes, and can save it.
    expect(container.textContent).toContain('"size": 9')
    expect(container.textContent).not.toContain(returned.data)
    const save = container.querySelector<HTMLAnchorElement>('a[aria-label="Save assets/figure.png"]')!
    expect(save.getAttribute('href')).toBe('blob:returned-file')
    expect(save.getAttribute('download')).toBe('figure.png')

    // Removing the file holds Run back again.
    await act(async () => button('Remove').click())
    expect(container.textContent).toContain('No file chosen')
    expect((button('Run') as HTMLButtonElement).disabled).toBe(true)
  })

  it('sends an optional file once it is picked, with the other optional fields that were filled in', async () => {
    const string = {type: 'hm://hyper.media/string'}
    // Everything optional, as a tool that takes either a file to start or a job to resume.
    mocks.schema = {
      type: 'hm://hyper.media/struct',
      properties: {
        file: {
          value: {
            type: 'hm://hyper.media/struct',
            properties: {
              name: {value: string, required: true},
              mimeType: {value: string, required: true},
              data: {value: string, required: true},
            },
          },
        },
        job: {value: string},
        maxPages: {value: {type: 'hm://hyper.media/integer'}},
      },
    }
    await render(true, {temp: 21}, {draft: {source: 'export default async () => ({})'}})
    const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!
    await act(async () => {
      Object.defineProperty(picker, 'files', {
        value: [new File(['hello'], 'paper.pdf', {type: 'application/pdf'})],
        configurable: true,
      })
      picker.dispatchEvent(new Event('change', {bubbles: true}))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(container.textContent).toContain('paper.pdf')
    const pages = container.querySelector<HTMLInputElement>('input[aria-label="maxPages"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(pages, '3')
      pages.dispatchEvent(new Event('input', {bubbles: true}))
    })
    // The file is still there after another field changed.
    expect(container.textContent).toContain('paper.pdf')
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent?.trim() === 'Run')!
        .click()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          _: 'TestAppTool',
          input: {file: {name: 'paper.pdf', mimeType: 'application/pdf', data: btoa('hello')}, maxPages: 3},
        }),
      }),
    )
  })

  it('names a file in a past run by its name', async () => {
    await render(true)
    // The record of a call holds a file as its name, type and size.
    const {inputSummary} = await import('../apps/running')
    expect(inputSummary({file: {name: 'paper.pdf', mimeType: 'application/pdf', size: 5}, mode: 'fast'})).toBe(
      'file: paper.pdf, mode: fast',
    )
  })

  it('runs the code on screen for someone who can write the tool, with no word about its state', async () => {
    await render(true, {temp: 21}, {draft: {source: 'export default async () => ({temp: 30})'}})
    const button = (text: string) =>
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)!
    // Run is just Run: the page does not say whether the code is published, a draft or an old version.
    expect(container.textContent).not.toContain('unpublished')
    expect(container.textContent).not.toContain('recorded')
    const input = container.querySelector<HTMLInputElement>('input[aria-label="city"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Lisbon')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    await act(async () => {
      button('Run').click()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        action: {
          _: 'TestAppTool',
          appId: appId.id,
          toolId: toolId.id,
          source: 'export default async () => ({temp: 30})',
          publicConfig: {},
          input: {city: 'Lisbon'},
        },
      }),
    )
    expect(mocks.send).not.toHaveBeenCalledWith(
      expect.objectContaining({action: expect.objectContaining({_: 'CallAppTool'})}),
    )
    const result = container.querySelector('[data-testid="tool-test-result"]')!
    expect(result.textContent).toContain('Succeeded')
    expect(result.textContent).not.toContain('recorded')
    expect(result.textContent).toContain('30')
    // What the code printed is shown with the result.
    expect(result.textContent).toContain('looked up Lisbon')
  })

  it('does not run a tool whose required config is not set: it names the fields and offers to set them', async () => {
    const onSetConfig = vi.fn()
    await render(
      true,
      {temp: 21},
      {draft: {source: 'export default async () => ({})'}, missingConfig: ['datalabApiKey'], onSetConfig},
    )
    const button = (text: string) =>
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)!
    // The input is complete, so only the missing config holds Run back.
    const input = container.querySelector<HTMLInputElement>('input[aria-label="city"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Lisbon')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    expect(button('Run').disabled).toBe(true)
    const alert = container.querySelector('[data-testid="tool-run-missing-config"]')!
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('Required config is not set: datalabApiKey.')
    expect(alert.className).toContain('text-destructive')
    act(() => button('Set it').click())
    expect(onSetConfig).toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalledWith(
      expect.objectContaining({action: expect.objectContaining({_: 'TestAppTool'})}),
    )
  })

  it('runs once the config is there, and shows no warning', async () => {
    await render(true, {temp: 21}, {draft: {source: 'export default async () => ({})'}, missingConfig: []})
    expect(container.querySelector('[data-testid="tool-run-missing-config"]')).toBeNull()
  })

  it('lets the author of a tool in no app run it with nothing to turn on, and tells readers how to use it', async () => {
    await render(false, {temp: 21}, {standalone: true, draft: {source: 'export default async () => 1'}})
    const labels = () => Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim())
    const input = container.querySelector<HTMLInputElement>('input[aria-label="city"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Lisbon')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent?.trim() === 'Run')!
        .click()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    // The code on screen is what runs, the tool as its own host, published or not.
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({_: 'TestAppTool', appId: appId.id, source: 'export default async () => 1'}),
      }),
    )
    // A tool in no app names no server: everything goes to the viewer's own, whatever its document says.
    expect(mocks.send.mock.calls.map(([sent]) => sent.serverUrl)).toEqual(
      mocks.send.mock.calls.map(() => 'http://mine.test'),
    )
    expect(container.textContent).not.toContain('not running')
    act(() => root.unmount())
    root = createRoot(container)
    await render(false, {temp: 21}, {standalone: true})
    expect(labels()).not.toContain('Run')
    expect(container.textContent).toContain('only people who can edit it can run it here')
    expect(container.textContent).toContain('Add it to an app or an agent')
  })

  it('says that the sandbox is being prepared while the server is still starting its first one', async () => {
    mocks.health = {status: 'ok', uptime: 1, sandboxWarmUp: {state: 'warming'}}
    await render(true)
    // Before anything is run, so a slow first run is expected and not a surprise.
    expect(container.querySelector('[data-testid="tool-run-progress"]')?.textContent).toContain(
      'The sandbox is being prepared',
    )
    act(() => root.unmount())
    root = createRoot(container)
    mocks.health = {status: 'ok', uptime: 1, sandboxWarmUp: {state: 'ready', durationMs: 40_000}}
    await render(true)
    expect(container.querySelector('[data-testid="tool-run-progress"]')).toBeNull()
  })

  it('tells a run in progress how long it has been, and why a long one is long', () => {
    // A quick run says nothing more than the button does.
    expect(runProgressText(0, false)).toBeNull()
    expect(runProgressText(3, false)).toBeNull()
    // A run that goes on is not left looking broken.
    expect(runProgressText(12, false)).toContain('Still running (12s)')
    expect(runProgressText(12, false)).toContain('starts the sandbox')
    // When the server says it is preparing the sandbox, that is the reason, from the first second.
    expect(runProgressText(1, true)).toContain('Preparing the sandbox (1s)')
  })

  it('lets someone who can write an app’s tool run it whether the app runs or not', async () => {
    await render(false, {temp: 21}, {draft: {source: 'export default async () => 1'}})
    expect(Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim())).toContain('Run')
    expect(container.textContent).not.toContain('This app is not running')
  })

  it('shows no form while the app is not running, only a way to its settings', async () => {
    await render(false)
    expect(container.textContent).toContain('This app is not running')
    expect(container.textContent).toContain('Run it from the app’s settings')
    // No form while the app is not running.
    expect(container.querySelector('input[aria-label="city"]')).toBeNull()
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Run')).toBe(false)
  })
})
