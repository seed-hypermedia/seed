// @vitest-environment jsdom
import React, {useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Outlet} from '@remix-run/react'
import {createRemixStub} from '@remix-run/testing'

const state = vi.hoisted(() => ({identity: {id: 'session', delegatedAccountUid: 'owner'} as any}))
vi.mock('@/auth', () => ({useLocalKeyPair: () => state.identity}))
vi.mock('../local-db', () => ({setPendingIntent: vi.fn()}))
vi.mock('../pending-intent', () => ({processPendingIntent: vi.fn()}))
vi.mock('@/site-context-bridge', () => ({useSiteContextSnapshot: () => ({universal: {}, navigation: {}})}))
vi.mock('../components/web-hosting', () => ({
  WebHostingDialog: ({onClose}: {onClose: () => void}) => {
    const [step, setStep] = useState('login')
    return (
      <>
        <span>{step}</span>
        <button onClick={() => setStep('Choose address')}>Continue hosting</button>
        <button onClick={onClose}>Done</button>
      </>
    )
  },
  WebDomainSettings: ({siteId}: {siteId: {uid: string}}) => <span>Settings for {siteId.uid}</span>,
}))

import {WebDomainHost} from '../components/web-domain-host'
import {usePublishSpaceDraft} from '../web-create-space-dialog'
import {setPendingIntent} from '../local-db'
import {processPendingIntent} from '../pending-intent'
import {
  inviteWebDomainPublication,
  openWebDomainSettings,
  setWebDomainRequest,
  webDomainRequest,
} from '../models/domain-publishing'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  state.identity = {id: 'session', delegatedAccountUid: 'owner'}
  setWebDomainRequest(null)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  setWebDomainRequest(null)
})

function button(text: string) {
  const element = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === text)
  expect(element, text).toBeTruthy()
  return element!
}

describe('persistent browser domain flow', () => {
  it('keeps the invitation mounted when first publication navigates away from its draft', async () => {
    let finishPublication: () => void = () => {}
    vi.mocked(processPendingIntent).mockImplementation(async () => {
      inviteWebDomainPublication(hmId('navigated-space'), 'owner')
      // Publication opens the invitation before the remaining draft cleanup finishes.
      await new Promise<void>((resolve) => {
        finishPublication = resolve
      })
      return {type: 'publish-draft', spaceUrl: '/hm/navigated-space'}
    })
    function Draft() {
      const publish = usePublishSpaceDraft()
      return <button onClick={() => void publish('home-draft')}>Publish draft</button>
    }
    const App = createRemixStub([
      {
        Component: () => (
          <>
            <Outlet />
            <WebDomainHost />
          </>
        ),
        children: [
          {path: '/draft', Component: Draft},
          {path: '/hm/navigated-space', Component: () => <p>Published space home</p>},
        ],
      },
    ])
    await act(async () => root.render(<App initialEntries={['/draft']} />))
    await act(async () => button('Publish draft').click())
    expect(setPendingIntent).toHaveBeenCalledWith({type: 'publish-draft', draftId: 'home-draft'})
    const invitation = document.querySelector('[role="dialog"]')
    expect(invitation?.textContent).toContain('Your space is published')
    await act(async () => finishPublication())
    expect(container.textContent).toContain('Published space home')
    expect(container.textContent).not.toContain('Publish draft')
    expect(document.querySelector('[role="dialog"]')).toBe(invitation)
    await act(async () => button('Publish to a Domain').click())
    expect(document.body.textContent).toContain('Continue hosting')
  })

  it('opens from first publication and retains the hosting step across page renders', async () => {
    await act(async () => {
      root.render(<WebDomainHost />)
      inviteWebDomainPublication(hmId('new-space'), 'owner')
    })
    expect(document.body.textContent).toContain('Your space is published')
    await act(async () => button('Publish to a Domain').click())
    await act(async () => button('Continue hosting').click())
    await act(async () => root.render(<WebDomainHost />))
    expect(document.body.textContent).toContain('Choose address')
    await act(async () => button('Done').click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('deduplicates invitations but lets the owner reopen settings after Not now', async () => {
    await act(async () => {
      root.render(<WebDomainHost />)
      inviteWebDomainPublication(hmId('dismissed-space'), 'owner')
    })
    await act(async () => button('Not now').click())
    act(() => inviteWebDomainPublication(hmId('dismissed-space'), 'owner'))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => openWebDomainSettings(hmId('dismissed-space'), 'owner'))
    expect(document.body.textContent).toContain('Settings for dismissed-space')
  })

  it('never exposes an old account dialog after switching identities', async () => {
    await act(async () => {
      root.render(<WebDomainHost />)
      openWebDomainSettings(hmId('owner'), 'owner')
    })
    state.identity = {id: 'different-session', delegatedAccountUid: 'someone-else'}
    await act(async () => root.render(<WebDomainHost />))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(webDomainRequest.get()).toBeNull()
  })
})
