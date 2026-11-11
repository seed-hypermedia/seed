// @vitest-environment jsdom
import type {HMDocument, HMMetadata} from '@seed-hypermedia/client/hm-types'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// The daemon is the one thing these tests cannot run: the home document it
// would serve, and the publish call each platform makes.
const home = vi.hoisted(() => ({current: null as null | Partial<HMDocument>}))
const mutateAsync = vi.hoisted(() => vi.fn())
vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: home.current ? {type: 'document', document: home.current} : undefined}),
}))

import {SettingsToggle, SpaceSettingsGeneral, useSpaceSettingsForm} from '../space-settings'
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
  mutateAsync.mockReset().mockResolvedValue(undefined)
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
  const form = useSpaceSettingsForm('space', {mutateAsync, isPending: false})
  return (
    <>
      <SpaceSettingsGeneral metadata={form.metadata} onMetadata={form.onMetadata} />
      <button disabled={!form.isDirty || form.isSaving} onClick={form.save}>
        Save
      </button>
    </>
  )
}

describe('SettingsToggle hint', () => {
  beforeEach(() => {
    // Positioning the tooltip measures it, which jsdom can't do.
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any
  })

  function hint() {
    return document.querySelector('[data-slot="tooltip-content"]')
  }
  function tap(element: Element) {
    act(() => {
      element.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true}))
    })
    act(() => {
      element.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })
  }
  function renderToggle() {
    render(<SettingsToggle id="toggle" label="Toggle" hint="What it does" checked onCheckedChange={() => {}} />)
    return container!.querySelector('[aria-label="About Toggle"]')!
  }

  it('opens when its question mark is tapped', () => {
    tap(renderToggle())
    expect(hint()?.textContent).toContain('What it does')
  })

  it('closes when the question mark is tapped again', () => {
    const icon = renderToggle()
    tap(icon)
    tap(icon)
    expect(hint()).toBeNull()
  })

  it('closes when anything else is tapped, including a blank area that sends no click', () => {
    tap(renderToggle())
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true}))
    })
    expect(hint()).toBeNull()
  })
})

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

  it('saves only the settings that changed, over the latest published metadata', async () => {
    render(<FormHarness />)

    act(() => switchFor('Show Document Browser').click())
    await act(async () => button('Save').click())

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    const published = {name: 'Renamed', showConversations: false}
    expect(mutateAsync.mock.lastCall![0].updateMetadata(published)).toEqual({...published, showDocumentBrowser: false})
  })
})
