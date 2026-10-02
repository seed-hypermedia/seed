import {hmId} from '@shm/shared'
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mockState = vi.hoisted(() => ({
  loggedIn: false,
  loginWithVault: vi.fn(),
  startEmailCode: vi.fn(),
  verifyEmailCode: vi.fn(),
}))

vi.mock('@/models/host', () => ({
  useHostSession: () => ({
    loggedIn: mockState.loggedIn,
    isSessionLoaded: true,
    email: mockState.loggedIn ? 'alice@example.com' : null,
    loginWithVault: mockState.loginWithVault,
    startEmailCode: {mutateAsync: mockState.startEmailCode, isLoading: false, error: null, reset: vi.fn()},
    verifyEmailCode: {mutate: mockState.verifyEmailCode, isLoading: false, error: null, reset: vi.fn()},
    logout: vi.fn(),
    createSite: {mutateAsync: vi.fn(), isLoading: false, error: null},
    hostInfo: {
      isLoading: false,
      error: null,
      data: {
        hostDomain: 'hyper.media',
        pricing: {
          free: {gbStorage: 1, gbBandwidth: 50, siteCount: 1},
          premium: {
            gbStorage: 20,
            gbBandwidth: 200,
            siteCount: 5,
            gbStorageOverageUSDCents: 10,
            gbBandwidthOverageUSDCents: 2,
            siteCountOverageUSDCents: 100,
            monthlyPriceUSDCents: 500,
          },
        },
      },
    },
  }),
}))

// The steps render inside the app dialog, which is not part of these tests.
vi.mock('@shm/ui/components/dialog', () => ({
  DialogHeader: (props: any) => <div {...props} />,
  DialogFooter: (props: any) => <div {...props} />,
  DialogTitle: (props: any) => <h2 {...props} />,
  DialogDescription: (props: any) => <p {...props} />,
}))

vi.mock('@/models/site', () => ({
  useSiteRegistration: () => ({mutateAsync: vi.fn(), isLoading: false, error: null}),
  useRemoveSite: () => ({mutate: vi.fn()}),
}))

vi.mock('@/models/entities', () => ({
  fetchResource: vi.fn(),
}))

vi.mock('@/utils/useNavigate', () => ({
  useNavigate: () => vi.fn(),
}))

import {PublishSiteDialog, SeedHostContent} from '../components/publish-site'

let root: Root
let container: HTMLDivElement

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  rerender()
}

function rerender() {
  act(() => {
    root.render(<SeedHostContent id={hmId('z6MkTestAccount')} onBack={() => {}} onClose={() => {}} />)
  })
}

function renderDialog() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<PublishSiteDialog input={{id: hmId('z6MkTestAccount')}} onClose={() => {}} />)
  })
}

function fireInput(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setValue.call(input, value)
  input.dispatchEvent(new Event('input', {bubbles: true}))
}

function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.includes(label),
  )
  expect(button, `button "${label}"`).toBeDefined()
  act(() => {
    button!.click()
  })
}

describe('choosing a domain', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    mockState.loggedIn = false
    mockState.loginWithVault.mockReset()
    renderDialog()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('offers a free domain and a custom domain', () => {
    expect(container.textContent).toContain('Free hyper.media domain')
    expect(container.textContent).toContain('Custom domain')
    expect(container.textContent).not.toContain('Self Host')
    expect(mockState.loginWithVault).not.toHaveBeenCalled()
  })

  it('goes straight to Seed hosting for a free domain', () => {
    click('Free hyper.media domain')
    expect(mockState.loginWithVault).toHaveBeenCalledTimes(1)
  })

  it('asks how to host a custom domain', () => {
    click('Custom domain')
    expect(container.textContent).toContain('Hosting by Seed Hypermedia')
    expect(container.textContent).toContain('Self Host on Your Own Server')
    expect(container.textContent).toContain('Paste a Hosting Setup URL')
    expect(mockState.loginWithVault).not.toHaveBeenCalled()
  })
})

describe('publishing to Seed hosting while connected to a remote vault', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    mockState.loggedIn = false
    mockState.loginWithVault.mockReset()
    mockState.startEmailCode.mockReset()
    mockState.verifyEmailCode.mockReset()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('opens without a pricing page', () => {
    render()
    expect(container.textContent).not.toContain('Get Started')
    expect(mockState.loginWithVault).toHaveBeenCalledTimes(1)
  })

  it('skips the email step when the vault login succeeds', () => {
    render()
    expect(mockState.loginWithVault).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('Log in to Seed Hosting')

    mockState.loggedIn = true
    act(() => {
      mockState.loginWithVault.mock.calls[0]![1].onSuccess()
    })
    rerender()

    expect(container.textContent).toContain('Choose Your Subdomain')
    expect(container.textContent).toContain('alice@example.com')
    expect(container.textContent).not.toContain('Log in to Seed Hosting')
  })

  it('asks for the email when the vault login is not possible', () => {
    render()

    act(() => {
      mockState.loginWithVault.mock.calls[0]![1].onError(new Error('Email validation required.'))
    })

    expect(container.textContent).toContain('Log in to Seed Hosting')
    expect(container.querySelector('input')).not.toBeNull()
  })

  it('logs in with a code sent by email', async () => {
    render()
    act(() => {
      mockState.loginWithVault.mock.calls[0]![1].onError(new Error('Email validation required.'))
    })
    mockState.startEmailCode.mockResolvedValue({
      status: 'code-sent',
      email: 'alice@example.com',
      binding: 'binding-1',
      expireTime: Date.now() + 15 * 60_000,
      resendAllowedTime: Date.now() + 60_000,
    })

    const emailInput = container.querySelector('input')!
    await act(async () => {
      fireInput(emailInput, 'alice@example.com')
      container.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
      // react-hook-form validates asynchronously before submitting
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(mockState.startEmailCode).toHaveBeenCalledWith('alice@example.com')
    expect(container.textContent).toContain('Check Your Inbox')
    expect(container.textContent).toContain('alice@example.com')

    const digits = Array.from(container.querySelectorAll('input[inputmode="numeric"]')) as HTMLInputElement[]
    expect(digits).toHaveLength(4)
    await act(async () => {
      '4821'.split('').forEach((digit, i) => fireInput(digits[i]!, digit))
    })
    expect(mockState.verifyEmailCode).toHaveBeenCalledWith({
      email: 'alice@example.com',
      binding: 'binding-1',
      code: '4821',
    })
  })

  it('does not ask the vault when already logged in', () => {
    mockState.loggedIn = true
    render()

    expect(mockState.loginWithVault).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Choose Your Subdomain')
  })
})
