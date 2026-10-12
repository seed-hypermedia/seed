// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const state = vi.hoisted(() => ({
  host: {} as any,
  permission: {} as any,
  identity: {} as any,
  identityLoaded: true,
  resource: {} as any,
  register: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  navigate: vi.fn(),
  redirectToVault: vi.fn(),
}))
vi.mock('@/models/host', () => ({
  useHostSession: (options?: any) => {
    state.host.onAuthenticated = options?.onAuthenticated
    return state.host
  },
}))
vi.mock('@/models/site', () => ({
  useSiteRegistration: () => ({mutateAsync: state.register}),
  useRemoveSite: () => ({mutateAsync: state.remove}),
  updateMovedSitePublication: (...args: unknown[]) => state.update(...args),
}))
vi.mock('@/auth', () => ({
  redirectToVaultSignIn: (...args: unknown[]) => state.redirectToVault(...args),
  useLocalKeyPair: () => state.identity,
  useLocalKeyPairLoaded: () => state.identityLoaded,
}))
vi.mock('@/document-edit/use-web-can-edit', () => ({useWebCanEdit: () => state.permission}))
vi.mock('@shm/shared/models/entity', () => ({useResource: () => state.resource}))
vi.mock('@shm/ui/toast', () => ({toast: {success: vi.fn()}}))
vi.mock('@shm/ui/button', () => ({
  Button: ({loading, variant, children, ...props}: any) => (
    <button {...props} disabled={props.disabled || loading}>
      {children}
    </button>
  ),
}))
vi.mock('@shm/ui/components/code-input', () => ({
  CodeInput: ({length, onChange, onComplete}: any) => (
    <input
      aria-label="Login code"
      maxLength={length}
      onChange={(event) => {
        onChange(event.target.value)
        if (event.target.value.length === length) onComplete(event.target.value)
      }}
    />
  ),
}))
vi.mock('@shm/ui/text', () => ({
  SizableText: ({children}: any) => <span>{children}</span>,
  Text: React.forwardRef(({children}: any, ref: any) => <span ref={ref}>{children}</span>),
}))
vi.mock('@shm/ui/tooltip', () => ({Tooltip: ({children}: any) => <>{children}</>}))
vi.mock('@shm/shared', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  useUniversalAppContext: () => ({openUrl: state.navigate}),
}))
vi.mock('@shm/ui/components/dialog', () => ({
  Dialog: ({open, children}: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({children}: any) => <div>{children}</div>,
  DialogDescription: ({children}: any) => <p>{children}</p>,
  DialogFooter: ({children}: any) => <div>{children}</div>,
  DialogHeader: ({children}: any) => <div>{children}</div>,
  DialogTitle: ({children}: any) => <h2>{children}</h2>,
}))
import {WebDomainSettings, WebHostingDialog} from './web-hosting'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const id = {uid: 'space', id: 'hm://space', path: []} as any
let root: Root
let container: HTMLDivElement
function mutation() {
  return {mutateAsync: vi.fn(), mutate: vi.fn(), reset: vi.fn(), isLoading: false, error: null}
}
function render(element: React.ReactNode) {
  act(() => root.render(element))
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(
    (button) => button.textContent?.startsWith(label) || button.getAttribute('aria-label') === label,
  )
  expect(button, label).toBeTruthy()
  await act(async () => button!.click())
}
async function input(label: string, value: string) {
  const fieldLabel = [...container.querySelectorAll('label')].find((el) => el.textContent?.includes(label))
  const element =
    fieldLabel?.querySelector('input') ||
    (fieldLabel?.htmlFor ? document.getElementById(fieldLabel.htmlFor) : null) ||
    container.querySelector(`input[aria-label="${label}"]`)
  expect(element).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element!.dispatchEvent(new Event('input', {bubbles: true}))
  })
}
async function submit() {
  await act(async () =>
    container.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})),
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  state.identityLoaded = true
  // Reproduce a delegated owner viewing their space through another site's origin.
  state.permission = {canEdit: false, signingAccountId: 'space', capabilitiesLoading: false}
  state.identity = {id: 'browser-key', delegatedAccountUid: 'space', capabilityCid: 'owner-delegation'}
  state.resource = {
    data: {type: 'document', document: {metadata: {siteUrl: 'https://old.seed.host'}, visibility: 'PUBLIC'}},
  }
  state.host = {
    loggedIn: true,
    isSessionLoaded: true,
    email: 'owner@example.com',
    hostInfo: {data: {hostDomain: 'seed.host'}},
    sites: {
      data: [
        {
          id: 'hostsite',
          name: 'old',
          url: 'https://old.seed.host',
          activeConfig: {registeredAccountUid: 'space'},
          customDomains: [],
          services: [],
        },
      ],
      refetch: vi.fn(),
    },
    pendingDomains: [],
    domainStatus: {error: null, isError: false},
    pendingSiteMoves: [],
    startEmailCode: mutation(),
    verifyEmailCode: mutation(),
    canLoginWithVault: false,
    vaultEmail: undefined,
    loginWithVault: vi.fn(),
    createSite: mutation(),
    createDomain: mutation(),
    cancelPendingDomain: mutation(),
    renameSite: mutation(),
    transferSite: mutation(),
    recoverSiteMove: mutation(),
    clearPendingSiteMove: vi.fn(),
    logout: vi.fn(),
    retryPendingDomains: vi.fn(),
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('browser hosting workflows', () => {
  it.each([
    {id: 'key', delegatedAccountUid: 'writer', capabilityCid: 'writer-cap'},
    null,
    {id: 'space'},
    {id: 'key', delegatedAccountUid: 'space'},
  ])('hides settings and first-publish actions without the owner delegation: %j', (identity) => {
    state.identity = identity
    render(<WebDomainSettings siteId={id} />)
    expect(container.textContent).toContain('Sign in as the space owner')
    expect(container.querySelector('button')).toBeNull()
    render(<WebHostingDialog input={{id}} onClose={vi.fn()} />)
    expect(container.textContent).toContain('Sign in as the space owner')
    expect(container.querySelector('button')).toBeNull()
  })
  it('lets a delegated owner manage hosting when the current site excludes them from editing', () => {
    render(<WebDomainSettings siteId={id} />)
    expect(container.textContent).toContain('Change Site Address')
    expect(container.textContent).not.toContain('Sign in as the space owner')
  })
  it('lets a delegated owner start hosting immediately after first publication on another site', () => {
    state.resource.data.document.metadata = {}
    render(<WebHostingDialog input={{id}} onClose={vi.fn()} />)
    expect(container.textContent).not.toContain('Sign in as the space owner')
    expect(container.textContent).toContain('Publish')
    expect(container.querySelector('button')).not.toBeNull()
  })
  it('waits for the browser identity before deciding ownership', () => {
    state.identity = null
    state.identityLoaded = false
    render(<WebDomainSettings siteId={id} />)
    expect(container.textContent).toContain('Loading web domain')
    expect(container.textContent).not.toContain('Sign in as the space owner')
    render(<WebHostingDialog input={{id}} onClose={vi.fn()} />)
    expect(container.textContent).toContain('Loading hosting settings')
    expect(container.textContent).not.toContain('Sign in as the space owner')
  })
  it('shares all desktop domain and hosting choices', async () => {
    render(<WebHostingDialog input={{id}} onClose={vi.fn()} />)
    expect(container.textContent).toContain('Where should this space be available?')
    expect(container.textContent).toContain('Free seed.host domain')
    expect(container.textContent).toContain('Custom domain')
    expect(container.textContent).not.toContain('Connect an Existing Site')
    await click('Custom domain')
    expect(container.textContent).toContain('How would you like to host the space?')
    expect(container.textContent).toContain('Hosting by Seed Hypermedia')
    expect(container.textContent).not.toContain('Connect an Existing Site')
    expect(container.textContent).toContain('Self Host on Your Own Server')
    expect(container.textContent).toContain('Paste a Hosting Setup URL')
    await click('Back')
    expect(container.textContent).toContain('Where should this space be available?')
  })
  it('uses the shared self-host guide and setup flow without a Seed Hosting session', async () => {
    state.host.loggedIn = false
    state.host.isSessionLoaded = false
    state.host.hostInfo = {isError: true, error: new Error('Seed Hosting offline')}
    state.register.mockResolvedValue('https://selfhost.example')
    render(<WebHostingDialog input={{id}} onClose={vi.fn()} />)
    await click('Custom domain')
    await click('Self Host on Your Own Server')
    expect(container.textContent).toContain('Host on Your Own Server')
    await click('Open Setup Guide')
    expect(state.navigate).toHaveBeenCalledWith(expect.stringContaining('/resources/self-host-seed'), true)
    await click('My Setup URL is Ready')
    await input('Space Setup URL', 'https://selfhost.example/hm/register?secret=owner-setup')
    await submit()
    expect(state.register).toHaveBeenCalledWith({url: 'https://selfhost.example/hm/register?secret=owner-setup'})
    expect(container.textContent).toContain('Published to selfhost.example!')
    expect(container.textContent).not.toContain('Publish Custom Domain')
    expect(state.host.startEmailCode.mutateAsync).not.toHaveBeenCalled()
    expect(state.host.createSite.mutateAsync).not.toHaveBeenCalled()
  })
  it('retains the setup URL for retry when self-host publication fails', async () => {
    state.host.loggedIn = false
    state.register
      .mockRejectedValueOnce(new Error('Could not connect to your server'))
      .mockResolvedValueOnce('https://selfhost.example')
    render(<WebHostingDialog input={{id}} onClose={vi.fn()} />)
    await click('Custom domain')
    await click('Paste a Hosting Setup URL')
    await input('Space Setup URL', 'https://selfhost.example/hm/register?secret=retry-secret')
    await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not connect')
    expect((container.querySelector('input') as HTMLInputElement).value).toContain('retry-secret')
    await submit()
    expect(state.register).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Published to selfhost.example!')
  })
  it('prevents duplicate setup submissions and closing while registration is pending', async () => {
    let finish!: (url: string) => void
    state.register.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
    )
    const protect = vi.fn()
    render(<WebHostingDialog input={{id}} onClose={vi.fn()} setDialogCloseProtection={protect} />)
    await click('Custom domain')
    await click('Paste a Hosting Setup URL')
    await input('Space Setup URL', 'https://selfhost.example/hm/register?secret=once')
    await submit()
    await submit()
    expect(state.register).toHaveBeenCalledTimes(1)
    expect(protect).toHaveBeenLastCalledWith({preventClose: true, showCloseButton: false})
    expect((container.querySelector('input') as HTMLInputElement).disabled).toBe(true)
    await act(async () => finish('https://selfhost.example'))
    expect(protect).toHaveBeenLastCalledWith({preventClose: false, showCloseButton: true})
  })
  it('only shows rename and transfer for a site owned by the signed-in hosting account', () => {
    state.host.sites.data[0].activeConfig.registeredAccountUid = 'other-space'
    render(<WebDomainSettings siteId={id} />)
    expect(container.textContent).not.toContain('Change Site Address')
    expect(container.textContent).not.toContain('Transfer Hosting')
    expect(container.textContent).not.toContain('Publish Custom Domain')
  })
  it('accepts four-digit email codes, resends, and returns to the email form', async () => {
    state.host.loggedIn = false
    state.host.startEmailCode.mutateAsync.mockResolvedValue({
      email: 'owner@example.com',
      binding: 'binding',
      expireTime: Date.now() + 60000,
      resendAllowedTime: 0,
    })
    render(<WebHostingDialog input={{id, step: 'seed-host-subdomain'}} onClose={vi.fn()} />)
    await input('Email Address', 'owner@example.com')
    await submit()
    expect(container.textContent).toContain('4-digit code')
    await input('Login code', '1234')
    expect(state.host.verifyEmailCode.mutate).toHaveBeenCalledWith({
      email: 'owner@example.com',
      binding: 'binding',
      code: '1234',
    })
    await click('Resend Code')
    expect(state.host.startEmailCode.mutateAsync).toHaveBeenCalledTimes(2)
    await click('Back')
    expect(container.textContent).toContain('Email Address')
  })
  it('retries publication without creating another hosting site', async () => {
    state.resource.data.document.metadata.siteUrl = ''
    state.host.createSite.mutateAsync.mockResolvedValue({setupUrl: 'https://new.seed.host?secret=123'})
    state.register
      .mockRejectedValueOnce(new Error('Temporary publication failure'))
      .mockResolvedValueOnce('https://new.seed.host')
    render(<WebHostingDialog input={{id, step: 'seed-host-subdomain'}} onClose={vi.fn()} />)
    await input('Subdomain', 'new-space')
    await submit()
    expect(container.textContent).toContain('Temporary publication failure')
    await submit()
    expect(state.host.createSite.mutateAsync).toHaveBeenCalledTimes(1)
    expect(state.register).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Published to the Web!')
  })
  it('keeps DNS progress and cancellation visible after reopening settings', async () => {
    state.host.pendingDomains = [{id: 'domain', hostname: 'www.example.com', siteUid: 'space', status: 'waiting-dns'}]
    render(<WebDomainSettings siteId={id} />)
    expect(container.textContent).toContain('At your DNS provider')
    expect(container.textContent).toContain('www.example.com')
    await click('Cancel Domain Setup')
    expect(state.host.cancelPendingDomain.mutateAsync).toHaveBeenCalledWith('domain')
  })
  it('resumes a durable address move before clearing the recovery record', async () => {
    const move = {
      id: 'hostsite',
      siteUid: 'space',
      oldName: 'old',
      newName: 'new',
      oldUrl: 'https://old.seed.host',
      email: 'owner@example.com',
    }
    state.host.pendingSiteMoves = [move]
    state.host.recoverSiteMove.mutateAsync.mockResolvedValue('https://new.seed.host')
    render(<WebDomainSettings siteId={id} />)
    await click('Resume Address Change')
    expect(state.host.recoverSiteMove.mutateAsync).toHaveBeenCalledWith(move)
    expect(state.update).toHaveBeenCalledWith(id, 'https://old.seed.host', 'https://new.seed.host')
    expect(state.host.clearPendingSiteMove).toHaveBeenCalledWith('hostsite')
  })
  it('disables ownership transfer while a paid service is active', () => {
    state.host.sites.data[0].services = [{serviceEnd: null, plan: {dedicatedServerType: 'server'}}]
    render(<WebDomainSettings siteId={id} />)
    for (const label of ['Transfer Hosting', 'Change Site Address'])
      expect(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent?.startsWith(label) || button.getAttribute('aria-label') === label,
        )?.disabled,
      ).toBe(true)
  })
})

describe('hosting ownership mutations', () => {
  it('does not repeat a successful rename when publishing the new URL needs retry', async () => {
    state.host.renameSite.mutateAsync.mockResolvedValue({url: 'https://new.seed.host'})
    state.update.mockRejectedValueOnce(new Error('Publication offline')).mockResolvedValueOnce(undefined)
    render(<WebDomainSettings siteId={id} />)
    await click('Change Site Address')
    await input('New subdomain', 'new')
    await input('Type old to confirm', 'old')
    await submit()
    expect(container.textContent).toContain('Publication offline')
    expect(state.host.clearPendingSiteMove).not.toHaveBeenCalled()
    await submit()
    expect(state.host.renameSite.mutateAsync).toHaveBeenCalledTimes(1)
    expect(state.update).toHaveBeenCalledTimes(2)
    expect(state.host.clearPendingSiteMove).toHaveBeenCalledWith('hostsite')
  })
  it('transfers to the recipient only after the current name is confirmed', async () => {
    state.host.transferSite.mutateAsync.mockResolvedValue({email: 'recipient@example.com'})
    render(<WebDomainSettings siteId={id} />)
    await click('Transfer Hosting')
    await input('Recipient email', 'recipient@example.com')
    await submit()
    expect(state.host.transferSite.mutateAsync).not.toHaveBeenCalled()
    await input('Type old to confirm', 'old')
    await submit()
    expect(state.host.transferSite.mutateAsync).toHaveBeenCalledWith({
      id: 'hostsite',
      currentName: 'old',
      email: 'recipient@example.com',
    })
    expect(state.update).not.toHaveBeenCalled()
  })
})

describe('hosting recovery after reopening', () => {
  it('offers custom domain replacement for an owned site already using a custom domain', () => {
    state.resource.data.document.metadata.siteUrl = 'https://existing.example.com'
    state.host.sites.data[0].customDomains = ['existing.example.com']
    render(<WebDomainSettings siteId={id} />)
    expect(container.textContent).toContain('Publish Custom Domain')
    expect(container.textContent).toContain('Change Site Address')
  })
  it('shows the domain publication error and retries without creating a new domain', async () => {
    state.host.pendingDomains = [
      {
        id: 'domain',
        hostname: 'www.example.com',
        siteUid: 'space',
        status: 'error',
        errorMessage: 'Domain is active, but publication could not be updated.',
      },
    ]
    render(<WebDomainSettings siteId={id} />)
    expect(container.textContent).toContain('Domain is active, but publication could not be updated.')
    await click('Retry Domain Setup')
    expect(state.host.retryPendingDomains).toHaveBeenCalledTimes(1)
    expect(state.host.createDomain.mutateAsync).not.toHaveBeenCalled()
  })
})

describe('hosting navigation and polling errors', () => {
  it('replaces a custom domain using the managed site for the API and DNS target', async () => {
    state.resource.data.document.metadata.siteUrl = 'https://current.example.com'
    state.host.sites.data[0].customDomains = ['current.example.com']
    state.host.createDomain.mutateAsync.mockResolvedValue({hostname: 'next.example.com'})
    render(<WebHostingDialog input={{id, step: 'seed-host-custom-domain'}} onClose={vi.fn()} />)
    await input('Domain Name', 'next.example.com')
    await submit()
    expect(state.host.createDomain.mutateAsync).toHaveBeenCalledWith({
      id,
      hostname: 'next.example.com',
      currentSiteUrl: 'https://current.example.com',
      hostingSiteUrl: 'https://old.seed.host',
    })
    state.host.pendingDomains = [
      {
        id: 'domain',
        hostname: 'next.example.com',
        siteUid: 'space',
        status: 'waiting-dns',
        hostingSiteUrl: 'https://old.seed.host',
      },
    ]
    render(<WebHostingDialog input={{id, step: 'seed-host-custom-domain'}} onClose={vi.fn()} />)
    expect([...container.querySelectorAll('strong')].map((element) => element.textContent)).toEqual([
      'next.example.com',
      'old.seed.host',
    ])
  })

  it('surfaces failed domain polling and offers a retry while DNS is still pending', async () => {
    state.host.pendingDomains = [{id: 'domain', hostname: 'example.com', siteUid: 'space', status: 'waiting-dns'}]
    state.host.domainStatus = {isError: true, error: new Error('Unable to reach Seed Hosting')}
    render(<WebDomainSettings siteId={id} />)
    expect(container.textContent).toContain('Unable to reach Seed Hosting')
    await click('Retry Domain Setup')
    expect(state.host.retryPendingDomains).toHaveBeenCalledTimes(1)
    expect(state.host.createDomain.mutateAsync).not.toHaveBeenCalled()
  })

  it.each([
    ['Free seed.host domain', 'Choose Your Subdomain'],
    ['Hosting by Seed Hypermedia', 'Set Up Custom Domain'],
  ])('preserves %s through hosting login', async (choice, expected) => {
    state.host.loggedIn = false
    render(<WebHostingDialog input={{id}} onClose={vi.fn()} />)
    if (choice !== 'Free seed.host domain') await click('Custom domain')
    await click(choice)
    expect(container.textContent).toContain('Log in to Seed Hosting')
    state.host.loggedIn = true
    render(<WebHostingDialog input={{id}} onClose={vi.fn()} />)
    expect(container.textContent).toContain(expected)
    expect(container.textContent).not.toContain('Free seed.host domain')
  })

  it('discards another hosting account’s reserved setup URL and form values', async () => {
    state.resource.data.document.metadata.siteUrl = ''
    state.host.createSite.mutateAsync.mockResolvedValue({setupUrl: 'https://reserved.seed.host?secret=first-account'})
    state.register.mockRejectedValueOnce(new Error('Temporary publication failure'))
    render(<WebHostingDialog input={{id, step: 'seed-host-subdomain'}} onClose={vi.fn()} />)
    await input('Subdomain', 'reserved')
    await submit()
    expect(container.textContent).toContain('Finish Publishing')
    state.host.email = 'another@example.com'
    render(<WebHostingDialog input={{id, step: 'seed-host-subdomain'}} onClose={vi.fn()} />)
    expect(container.textContent).toContain('Choose Your Subdomain')
    expect(container.textContent).not.toContain('Finish Publishing')
    expect(container.querySelector('input')?.value).toBe('')
  })
})

it('tries vault prevalidation before showing the hosting email form', async () => {
  state.host.loggedIn = false
  state.host.canLoginWithVault = true
  state.host.vaultEmail = 'verified@example.com'
  render(<WebHostingDialog input={{id, step: 'seed-host-subdomain'}} onClose={vi.fn()} />)
  expect(state.host.loginWithVault).toHaveBeenCalledTimes(1)
  expect(container.textContent).toContain('Signing in…')
  expect(container.querySelector('input[type="email"]')).toBeNull()
  // An existing account or untrusted vault falls back to the normal code flow.
  await act(async () => state.host.loginWithVault.mock.calls[0][1].onSettled())
  expect((container.querySelector('input[type="email"]') as HTMLInputElement).value).toBe('verified@example.com')
  expect(state.host.startEmailCode.mutateAsync).not.toHaveBeenCalled()
  expect(state.host.loginWithVault).toHaveBeenCalledTimes(1)
})

it('opens the subdomain form directly for a signed-in hosting account', () => {
  state.identity.vaultUrl = 'https://vault.example.com/vault/delegate'
  render(<WebHostingDialog input={{id, step: 'seed-host-subdomain'}} onClose={vi.fn()} />)
  expect(container.textContent).toContain('Choose Your Subdomain')
  expect(container.textContent).toContain('owner@example.com')
  expect(container.textContent).toContain('Switch account')
  expect(container.textContent).not.toContain('Continue with Seed Vault')
  expect(container.textContent).not.toContain('Use an email code instead')
  expect(state.redirectToVault).not.toHaveBeenCalled()
})

it('continues from automatic Vault login to the subdomain form without an extra choice', async () => {
  state.host.loggedIn = false
  state.host.canLoginWithVault = true
  state.host.vaultEmail = 'verified@example.com'
  render(<WebHostingDialog input={{id, step: 'seed-host-subdomain'}} onClose={vi.fn()} />)
  expect(state.host.loginWithVault).toHaveBeenCalledTimes(1)
  state.host.loggedIn = true
  state.host.email = 'verified@example.com'
  render(<WebHostingDialog input={{id, step: 'seed-host-subdomain'}} onClose={vi.fn()} />)
  expect(container.textContent).toContain('Choose Your Subdomain')
  expect(container.textContent).toContain('verified@example.com')
  expect(container.textContent).toContain('Switch account')
  expect(container.querySelector('input[type="email"]')).toBeNull()
  expect(container.textContent).not.toContain('Continue with Seed Vault')
})

it.each(['seed-host-subdomain', 'seed-host-custom-domain'] as const)(
  'keeps an explicit account switch in email login through the hosting-session remount: %s',
  async (step) => {
    state.host.canLoginWithVault = true
    state.host.vaultEmail = 'original@example.com'
    render(<WebHostingDialog input={{id, step}} onClose={vi.fn()} />)
    await click('Switch account')
    expect(state.host.logout).toHaveBeenCalledTimes(1)
    state.host.loggedIn = false
    render(<WebHostingDialog input={{id, step}} onClose={vi.fn()} />)
    expect(container.textContent).toContain('Log in to Seed Hosting')
    expect((container.querySelector('input[type="email"]') as HTMLInputElement).value).toBe('')
    expect(state.host.loginWithVault).not.toHaveBeenCalled()
    expect(state.host.startEmailCode.mutateAsync).not.toHaveBeenCalled()
    expect(state.redirectToVault).not.toHaveBeenCalled()
    state.host.loggedIn = true
    state.host.email = 'different@example.com'
    render(<WebHostingDialog input={{id, step}} onClose={vi.fn()} />)
    expect(container.textContent).toContain(
      step === 'seed-host-subdomain' ? 'Choose Your Subdomain' : 'Set Up Custom Domain',
    )
    expect(container.textContent).toContain('different@example.com')
  },
)

it('uses the email fallback without a Vault redirect loop when no proof is available', () => {
  state.host.loggedIn = false
  state.identity.vaultUrl = 'https://vault.example.com/vault/delegate'
  render(<WebHostingDialog input={{id, step: 'seed-host-subdomain'}} onClose={vi.fn()} />)
  expect(container.querySelector('input[type="email"]')).not.toBeNull()
  expect(container.textContent).not.toContain('Continue with Seed Vault')
  expect(container.textContent).not.toContain('Use an email code instead')
  expect(state.redirectToVault).not.toHaveBeenCalled()
  expect(state.host.startEmailCode.mutateAsync).not.toHaveBeenCalled()
})

it('resumes an owned unregistered address after reopening the publishing dialog', async () => {
  state.resource.data.document.metadata.siteUrl = ''
  state.host.sites.data = [
    {
      id: 'reserved-id',
      name: 'foo123444',
      url: 'http://foo123444.localhost:3000',
      activeConfig: {availableRegistrationSecret: 'reserved-secret'},
      customDomains: [],
      services: [],
    },
  ]
  state.register.mockResolvedValue('http://foo123444.localhost:3000')
  render(<WebHostingDialog input={{id, step: 'seed-host-subdomain'}} onClose={vi.fn()} />)
  await input('Subdomain', 'foo123444')
  await submit()
  expect(state.host.createSite.mutateAsync).not.toHaveBeenCalled()
  expect(state.register).toHaveBeenCalledExactlyOnceWith({
    url: 'http://foo123444.localhost:3000/hm/register?secret=reserved-secret',
  })
  expect(container.textContent).toContain('http://foo123444.localhost:3000')
  expect(container.textContent).not.toContain('reserved-secret')
})

it('does not reuse an address already registered to another space', async () => {
  state.resource.data.document.metadata.siteUrl = ''
  state.host.sites.data = [
    {
      id: 'reserved-id',
      name: 'foo123444',
      url: 'http://foo123444.localhost:3000',
      activeConfig: {registeredAccountUid: 'another-space', availableRegistrationSecret: 'stale-secret'},
      customDomains: [],
      services: [],
    },
  ]
  state.host.createSite.mutateAsync.mockRejectedValue(new Error('Subdomain already in use.'))
  render(<WebHostingDialog input={{id, step: 'seed-host-subdomain'}} onClose={vi.fn()} />)
  await input('Subdomain', 'foo123444')
  await submit()
  expect(state.register).not.toHaveBeenCalled()
  expect(container.textContent).toContain('Subdomain already in use.')
})
