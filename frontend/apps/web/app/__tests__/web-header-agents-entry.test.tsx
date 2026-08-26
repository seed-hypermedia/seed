// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React

/**
 * The account menu's way into the agents panel.
 *
 * A space names the agents server its readers connect to, in its home document. A space that names
 * none has nothing for a reader to talk to, so browsing it must not offer the entry point at all —
 * opening the panel there would only show an empty picker.
 */

const mockState = vi.hoisted(() => ({
  homeMetadata: {} as Record<string, unknown>,
}))

// Partial mocks throughout: only the data this component reads is faked, so the rest of each
// module keeps working and the test does not have to model the whole app.
vi.mock('@shm/shared/models/entity', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAccount: () => ({data: {id: {uid: 'reader-uid'}, metadata: {name: 'Reader'}}}),
  useResource: () => ({data: {type: 'document', document: {metadata: mockState.homeMetadata}}}),
}))
vi.mock('@shm/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useJoinSite: () => ({isJoined: true, joinSite: vi.fn()}),
}))
// The account menu renders at mobile width, where it is an inline sheet rather than a portal.
vi.mock('@shm/ui/use-media', () => ({useMedia: () => ({xs: true})}))
vi.mock('../auth', () => ({
  useLocalKeyPair: () => ({id: 'reader-uid', notifyServerUrl: null}),
  useCreateAccount: () => ({content: null, createAccount: vi.fn()}),
  LogoutDialog: () => null,
}))
vi.mock('../web-create-space-dialog', () => ({
  useCreateSpaceDialog: () => ({open: vi.fn(), content: null}),
  useHasExistingSpace: () => ({data: true}),
}))
vi.mock('@shm/ui/universal-dialog', () => ({useAppDialog: () => ({open: vi.fn(), content: null})}))
vi.mock('@shm/shared/utils/navigation', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => vi.fn(),
  useNavRoute: () => ({key: 'document', id: {uid: 'space-uid', path: []}}),
}))

import {WebHeaderActions} from '../web-utils'

let container: HTMLDivElement
let root: Root

/**
 * Mounts the header, opens the account menu, and returns its text.
 *
 * At mobile width the menu is a sheet, which portals to the body to escape the header's transform —
 * so it is found on the document rather than in the container the header was rendered into.
 */
function openMenu(): string {
  act(() => {
    root.render(<WebHeaderActions siteUid="space-uid" />)
  })
  const avatarButton = container.querySelector('button')
  expect(avatarButton, 'no account button rendered').toBeTruthy()
  act(() => {
    avatarButton!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
  })
  const sheet = document.querySelector('[data-slot="mobile-panel-sheet"]')
  expect(sheet, 'the account menu did not render').toBeTruthy()
  return sheet!.textContent ?? ''
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0) as unknown as number
  ;(globalThis as any).cancelAnimationFrame = (handle: number) => clearTimeout(handle)
  // The sheet restores scroll position on unmount; jsdom implements neither of these.
  window.scrollTo = () => {}
  mockState.homeMetadata = {}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('agents entry in the web account menu', () => {
  it('offers agents on a space that names an agents server', () => {
    mockState.homeMetadata = {name: 'A Space', agentServerUrl: 'https://agents.example'}
    expect(openMenu()).toContain('Agents')
  })

  it('offers nothing on a space that names none', () => {
    mockState.homeMetadata = {name: 'A Space'}
    const menu = openMenu()
    expect(menu).not.toContain('Agents')
    // The rest of the menu is untouched, so the space is still perfectly usable.
    expect(menu).toContain('My Profile')
  })

  it('treats an empty server setting as none', () => {
    mockState.homeMetadata = {agentServerUrl: ''}
    expect(openMenu()).not.toContain('Agents')
  })
})
