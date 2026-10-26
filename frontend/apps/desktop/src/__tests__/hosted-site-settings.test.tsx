import {hmId} from '@shm/shared'
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const state = vi.hoisted(() => ({
  loggedIn: true,
  sites: [] as any[],
  rename: vi.fn(),
  transfer: vi.fn(),
  publish: vi.fn(),
  pendingMoves: [] as any[],
  recover: vi.fn(),
  clearMove: vi.fn(),
}))
vi.mock('@/models/host', () => ({
  useHostSession: () => ({
    loggedIn: state.loggedIn,
    email: 'owner@example.com',
    pendingSiteMoves: state.pendingMoves,
    recoverSiteMove: {mutateAsync: state.recover},
    clearPendingSiteMove: state.clearMove,
    isSessionLoaded: true,
    sites: {data: state.sites, isError: false, isInitialLoading: false},
    renameSite: {mutateAsync: state.rename},
    transferSite: {mutateAsync: state.transfer},
  }),
}))
vi.mock('@/models/site', () => ({updateMovedSitePublication: state.publish}))
vi.mock('@/components/publish-site', () => ({SeedHostLogin: () => <p>Hosting Login</p>}))
vi.mock('@shm/ui/toast', () => ({toast: {success: vi.fn()}}))

import {HostedSiteSettings} from '../components/hosted-site-settings'

const siteId = hmId('z6MkTestAccount')
const oldUrl = 'https://myspace.hyper.media'
const newUrl = 'https://newspace.hyper.media'
let root: Root
let container: HTMLDivElement
function render(siteUrl = oldUrl) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<HostedSiteSettings siteId={siteId} siteUrl={siteUrl} />))
}
function button(text: string) {
  const match = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === text)
  expect(match, text).toBeDefined()
  return match!
}
function click(text: string) {
  act(() => button(text).click())
}
function input(label: string, value: string) {
  const field = Array.from(document.querySelectorAll('label'))
    .find((labelEl) => labelEl.textContent?.includes(label))!
    .querySelector('input')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', {bubbles: true}))
  })
}
async function submit() {
  await act(async () => {
    document.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
  })
}

describe('desktop Seed Hosting controls', () => {
  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    state.loggedIn = true
    state.pendingMoves = []
    state.recover.mockReset().mockResolvedValue(newUrl)
    state.clearMove.mockReset().mockResolvedValue(undefined)
    state.sites = [
      {
        id: 'hosting-1',
        name: 'myspace',
        url: oldUrl,
        customDomains: ['custom.example.com'],
        activeConfig: {registeredAccountUid: siteId.uid},
        services: [],
      },
    ]
    state.rename.mockReset().mockResolvedValue({id: 'hosting-1', name: 'newspace', url: newUrl})
    state.transfer.mockReset().mockResolvedValue({success: true, email: 'new@example.com'})
    state.publish.mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })
  it('hides management for selfhosted spaces even if their hostname resembles Seed hosting', () => {
    state.sites[0].activeConfig.registeredAccountUid = 'other-space'
    render()
    expect(container.textContent).not.toContain('Change Site Address')
    expect(container.textContent).not.toContain('Transfer Hosting')
  })
  it('hides controls after the space has moved to selfhosting', () => {
    render('https://selfhost.example.com')
    expect(container.textContent).not.toContain('Change Site Address')
    expect(container.textContent).not.toContain('Transfer Hosting')
  })
  it('hides cached controls when signed out', () => {
    state.loggedIn = false
    render()
    expect(container.textContent).not.toContain('Change Site Address')
    click('Sign in to Seed Hosting')
    expect(document.body.textContent).toContain('Hosting Login')
  })
  it('requires confirmation before moving and then updates publication', async () => {
    render()
    click('Change Site Address')
    input('New subdomain', 'newspace')
    expect(button('Change Address').disabled).toBe(true)
    await submit()
    expect(state.rename).not.toHaveBeenCalled()
    input('Type myspace', 'myspace')
    await submit()
    expect(state.rename).toHaveBeenCalledWith({
      id: 'hosting-1',
      name: 'newspace',
      currentName: 'myspace',
      siteUid: siteId.uid,
      currentUrl: oldUrl,
    })
    expect(state.publish).toHaveBeenCalledWith(siteId, oldUrl, newUrl)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('keeps the dialog open on hosting errors', async () => {
    state.rename.mockRejectedValue(new Error('That address is already in use.'))
    render()
    click('Change Site Address')
    input('New subdomain', 'newspace')
    input('Type myspace', 'myspace')
    await submit()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('already in use')
    expect(state.publish).not.toHaveBeenCalled()
  })
  it('retries publication without renaming again when publishing fails after the move', async () => {
    state.publish.mockRejectedValueOnce(new Error('Device disconnected'))
    render()
    click('Change Site Address')
    input('New subdomain', 'newspace')
    input('Type myspace', 'myspace')
    await submit()
    expect(document.body.textContent).toContain('The hosting address has changed')
    expect(button('Retry Publication Update').disabled).toBe(false)
    await submit()
    expect(state.rename).toHaveBeenCalledTimes(1)
    expect(state.publish).toHaveBeenCalledTimes(2)
  })
  it('can close after a publication error and recover persisted moves after reopening', async () => {
    state.publish.mockRejectedValueOnce(new Error('Device disconnected'))
    render()
    click('Change Site Address')
    input('New subdomain', 'newspace')
    input('Type myspace', 'myspace')
    await submit()
    click('Close')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    act(() => root.unmount())
    container.remove()
    state.sites[0].url = newUrl
    state.sites[0].name = 'newspace'
    state.pendingMoves = [
      {
        id: 'hosting-1',
        siteUid: siteId.uid,
        oldName: 'myspace',
        newName: 'newspace',
        oldUrl,
        hostUrl: 'https://hosting.example.com',
        email: 'owner@example.com',
      },
    ]
    render()
    expect(container.textContent).not.toContain('Change Site Address')
    await act(async () => button('Resume Address Change').click())
    expect(state.recover).toHaveBeenCalledWith(state.pendingMoves[0])
    expect(state.clearMove).toHaveBeenCalledWith('hosting-1')
    expect(state.rename).toHaveBeenCalledTimes(1)
  })
  it('explains that a custom primary domain stays unchanged', () => {
    render('https://custom.example.com')
    click('Change Site Address')
    expect(document.body.textContent).toContain('Your published domain stays at https://custom.example.com')
  })
  it('transfers hosting with confirmation without changing publication or space identity', async () => {
    render()
    click('Transfer Hosting')
    expect(document.body.textContent).toContain('does not transfer ownership of the Seed space')
    input('Recipient email', 'new@example.com')
    input('Type myspace', 'myspace')
    await submit()
    expect(state.transfer).toHaveBeenCalledWith({id: 'hosting-1', email: 'new@example.com', currentName: 'myspace'})
    expect(state.publish).not.toHaveBeenCalled()
  })
  it('blocks paid-service transfers and dedicated hosting moves', () => {
    state.sites[0].services = [{serviceEnd: null, plan: {dedicatedServerType: 'dedicated'}}]
    render()
    expect(button('Transfer Hosting').disabled).toBe(true)
    expect(button('Change Site Address').disabled).toBe(true)
  })
})
