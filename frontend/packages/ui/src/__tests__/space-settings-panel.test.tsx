// @vitest-environment jsdom
import {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {readSpaceSettings, SpaceSettingsGeneral} from '../space-settings-panel'
import {TooltipProvider} from '../tooltip'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(metadata: HMMetadata, onMetadata: (values: Partial<HMMetadata>) => void) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    // The app provides this at its root; the toggles' ? tooltips need it in scope.
    root!.render(
      <TooltipProvider>
        <SpaceSettingsGeneral metadata={metadata} onMetadata={onMetadata} />
      </TooltipProvider>,
    )
  })
  return container
}

/** The switch rendered for a given toggle label. */
function switchFor(label: string) {
  const labelEl = [...container!.querySelectorAll('label')].find((el) => el.textContent?.trim() === label)
  if (!labelEl) throw new Error(`no toggle labelled ${label}`)
  return container!.querySelector<HTMLButtonElement>(`#${labelEl.htmlFor}`)!
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('readSpaceSettings', () => {
  it('treats every absent key as on, so spaces published before the keys existed are unchanged', () => {
    expect(readSpaceSettings({})).toEqual({
      showConversations: true,
      showActivity: true,
      showDocumentBrowser: true,
      showCollectionControls: true,
    })
    expect(readSpaceSettings(undefined)).toEqual(readSpaceSettings({}))
  })

  it('only false turns a setting off', () => {
    expect(readSpaceSettings({showDocumentBrowser: false}).showDocumentBrowser).toBe(false)
    expect(readSpaceSettings({showDocumentBrowser: true}).showDocumentBrowser).toBe(true)
  })
})

describe('SpaceSettingsGeneral', () => {
  it('turning conversations off takes the activity tabs with it', () => {
    const onMetadata = vi.fn()
    render({}, onMetadata)

    act(() => switchFor('Enable Conversations').click())

    expect(onMetadata).toHaveBeenCalledWith({showConversations: false, showActivity: false})
  })

  it('turning conversations back on leaves the activity tabs alone', () => {
    const onMetadata = vi.fn()
    render({showConversations: false, showActivity: false}, onMetadata)

    act(() => switchFor('Enable Conversations').click())

    expect(onMetadata).toHaveBeenCalledWith({showConversations: true})
  })

  it('disables the activity tabs toggle while conversations are off', () => {
    render({showConversations: false}, vi.fn())

    expect(switchFor('Enable Activity Tabs').disabled).toBe(true)
    expect(switchFor('Show Document Browser').disabled).toBe(false)
  })

  it('reports each independent toggle on its own', () => {
    const onMetadata = vi.fn()
    render({}, onMetadata)

    act(() => switchFor('Show Document Browser').click())
    expect(onMetadata).toHaveBeenCalledWith({showDocumentBrowser: false})

    act(() => switchFor('Show Collection view options and controls').click())
    expect(onMetadata).toHaveBeenCalledWith({showCollectionControls: false})
  })
})
