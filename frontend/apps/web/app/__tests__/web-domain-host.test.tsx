// @vitest-environment jsdom
import React, {useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'

const state = vi.hoisted(() => ({identity: {id: 'session', delegatedAccountUid: 'owner'} as any}))
vi.mock('@/auth', () => ({useLocalKeyPair: () => state.identity}))
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
import {
  inviteWebDomainPublication,
  openWebDomainSettings,
  setWebDomainRequest,
  webDomainRequest,
} from '../models/domain-publishing'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
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
