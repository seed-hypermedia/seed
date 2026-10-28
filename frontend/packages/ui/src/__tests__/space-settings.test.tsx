// @vitest-environment jsdom
import type {HMDocument, HMMetadata} from '@seed-hypermedia/client/hm-types'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// The daemon is the one thing these tests cannot run: the home document it
// would serve, and the publish call it would receive.
const home = vi.hoisted(() => ({current: null as null | Partial<HMDocument>}))
const publishDocument = vi.hoisted(() => vi.fn())
vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: home.current ? {type: 'document', document: home.current} : undefined}),
}))
vi.mock('@shm/shared/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/routing')>()),
  useUniversalClient: () => ({publishDocument}),
}))

import {SpaceSettingsGeneral, useSpaceSettingsForm} from '../space-settings'
import {TooltipProvider} from '../tooltip'

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(element: React.ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const queryClient = new QueryClient({defaultOptions: {mutations: {retry: false}}})
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{element}</TooltipProvider>
      </QueryClientProvider>,
    )
  })
}

/** The switch rendered for a given toggle label. */
function switchFor(label: string) {
  const labelEl = [...container!.querySelectorAll('label')].find((el) => el.textContent?.trim() === label)
  if (!labelEl) throw new Error(`no toggle labelled ${label}`)
  return container!.querySelector<HTMLButtonElement>(`#${labelEl.htmlFor}`)!
}

function button(text: string) {
  return [...container!.querySelectorAll('button')].find((el) => el.textContent?.trim() === text)!
}

beforeEach(() => {
  home.current = {version: 'v1', genesis: 'g', metadata: {name: 'Space'}}
  publishDocument.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('SpaceSettingsGeneral', () => {
  it('turning conversations off takes the activity tabs with it', () => {
    const onMetadata = vi.fn()
    render(<SpaceSettingsGeneral metadata={{}} onMetadata={onMetadata} />)

    act(() => switchFor('Enable Conversations').click())

    expect(onMetadata).toHaveBeenCalledWith({showConversations: false, showActivity: false})
  })

  it('turning conversations back on leaves the activity tabs alone', () => {
    const onMetadata = vi.fn()
    render(<SpaceSettingsGeneral metadata={{showConversations: false, showActivity: false}} onMetadata={onMetadata} />)

    act(() => switchFor('Enable Conversations').click())

    expect(onMetadata).toHaveBeenCalledWith({showConversations: true})
  })

  it('disables the activity tabs toggle while conversations are off', () => {
    render(<SpaceSettingsGeneral metadata={{showConversations: false} as HMMetadata} onMetadata={vi.fn()} />)

    expect(switchFor('Enable Activity Tabs').disabled).toBe(true)
    expect(switchFor('Show Document Browser').disabled).toBe(false)
  })

  it('reports each independent toggle on its own', () => {
    const onMetadata = vi.fn()
    render(<SpaceSettingsGeneral metadata={{}} onMetadata={onMetadata} />)

    act(() => switchFor('Show Document Browser').click())
    expect(onMetadata).toHaveBeenCalledWith({showDocumentBrowser: false})

    act(() => switchFor('Show Collection view options and controls').click())
    expect(onMetadata).toHaveBeenCalledWith({showCollectionControls: false})
  })
})

/** The General tab's form, as the settings page wires it up. */
function FormHarness() {
  const form = useSpaceSettingsForm('space')
  return (
    <>
      <SpaceSettingsGeneral metadata={form.metadata} onMetadata={form.onMetadata} />
      <button disabled={!form.isDirty || form.isSaving} onClick={form.save}>
        Save
      </button>
    </>
  )
}

describe('useSpaceSettingsForm', () => {
  it('is only dirty while a setting actually differs from the published one', () => {
    render(<FormHarness />)
    expect(button('Save').disabled).toBe(true)

    act(() => switchFor('Show Document Browser').click())
    expect(button('Save').disabled).toBe(false)

    // Back to where it started: nothing left to save.
    act(() => switchFor('Show Document Browser').click())
    expect(button('Save').disabled).toBe(true)
  })

  it('publishes the home document with only the settings that changed', async () => {
    render(<FormHarness />)

    act(() => switchFor('Show Document Browser').click())
    await act(async () => button('Save').click())

    expect(publishDocument).toHaveBeenCalledTimes(1)
    const [input] = publishDocument.mock.lastCall!
    expect(input).toMatchObject({signerAccountUid: 'space', account: 'space', baseVersion: 'v1', genesis: 'g'})
    expect(JSON.stringify(input.changes)).toContain('showDocumentBrowser')
    expect(JSON.stringify(input.changes)).not.toContain('showConversations')
  })
})
