// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {TooltipProvider} from '../tooltip'
import {Dialog, DialogContent} from '../components/dialog'
import {
  PublishDomainChoice,
  PublishHostingChoice,
  PublishSiteSuccess,
  PublishError,
  PublishStep,
  PublishSiteFlow,
} from '../publish-site'
const actions = vi.hoisted(() => ({open: vi.fn(), copy: vi.fn()}))
vi.mock('@shm/shared', () => ({
  hmId: (uid: string, options: any) => ({uid, id: `hm://${uid}`, ...options}),
  useUniversalAppContext: () => ({openUrl: actions.open}),
  hostnameStripProtocol: (url: string) => url.replace(/^https?:\/\//, ''),
}))
vi.mock('../copy-to-clipboard', () => ({copyTextToClipboard: actions.copy}))
vi.mock('../toast', () => ({toast: vi.fn()}))
;(globalThis as any).React = React
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
function render(children: React.ReactNode) {
  act(() =>
    root.render(
      <TooltipProvider>
        <Dialog open>
          <DialogContent>{children}</DialogContent>
        </Dialog>
      </TooltipProvider>,
    ),
  )
}
function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.includes(label) || button.getAttribute('aria-label') === label,
  )
  expect(button, label).toBeTruthy()
  act(() => button!.click())
}
it('offers exactly free and custom domain cards and calls their distinct workflows', () => {
  const free = vi.fn(),
    custom = vi.fn()
  render(<PublishDomainChoice hostDomain="example.test" onFreeDomain={free} onCustomDomain={custom} />)
  expect(document.body.textContent).toContain('Publish to the Web')
  expect(document.body.textContent).not.toContain('Connect an Existing Site')
  click('Free example.test domain')
  click('Custom domain')
  expect(free).toHaveBeenCalledOnce()
  expect(custom).toHaveBeenCalledOnce()
})
it('retains desktop self-host and setup-URL choices', () => {
  const back = vi.fn(),
    seed = vi.fn(),
    self = vi.fn(),
    setup = vi.fn()
  render(<PublishHostingChoice onBack={back} onSeedHosting={seed} onSelfHost={self} onSetupUrl={setup} />)
  click('Back')
  click('Hosting by Seed Hypermedia')
  expect(document.body.textContent).not.toContain('Connect an Existing Site')
  click('Self Host on Your Own Server')
  click('Paste a Hosting Setup URL')
  for (const handler of [back, seed, self, setup]) expect(handler).toHaveBeenCalledOnce()
})
it('uses the shared step title, content, and footer', () => {
  render(
    <PublishStep title="Publish" description="Choose your address" footer={<button>Continue</button>}>
      <p>Form content</p>
    </PublishStep>,
  )
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Form content')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Continue')
  expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBeTruthy()
})

it('completes a free site with the shared custom-domain action and URL controls', () => {
  const close = vi.fn(),
    custom = vi.fn()
  render(<PublishSiteSuccess url="https://space.example.test" onClose={close} onCustomDomain={custom} />)
  expect(document.body.textContent).toContain('Published to the Web!')
  click('Copy URL')
  click('Open')
  click('Publish Custom Domain')
  expect(actions.copy).toHaveBeenCalledWith('https://space.example.test')
  expect(actions.open).toHaveBeenCalledWith('https://space.example.test')
  expect(custom).toHaveBeenCalledOnce()
})
it('completes a custom domain with its hostname and Done action', () => {
  const close = vi.fn()
  render(<PublishSiteSuccess url="https://example.test" onClose={close} />)
  expect(document.body.textContent).toContain('Published to example.test!')
  expect(document.body.textContent).not.toContain('Publish Custom Domain')
  click('Done')
  expect(close).toHaveBeenCalledOnce()
})
it('announces publishing errors and omits the error box when clear', () => {
  render(
    <PublishStep title="Publish">
      <PublishError error="Try again" />
    </PublishStep>,
  )
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Try again')
  render(
    <PublishStep title="Publish">
      <PublishError error={null} />
    </PublishStep>,
  )
  expect(document.querySelector('[role="alert"]')).toBeNull()
})

function flow(props: Partial<React.ComponentProps<typeof PublishSiteFlow>> = {}) {
  return (
    <PublishSiteFlow
      hostDomain="seed.test"
      documentTitle="My Space"
      onClose={() => {}}
      onOpenSetupGuide={() => {}}
      onRegister={async () => 'https://self.test'}
      renderHosting={({customDomain}) => <p>{customDomain ? 'Hosted custom' : 'Hosted free'}</p>}
      {...props}
    />
  )
}
async function changeSetupUrl(value: string) {
  const input = document.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
}
async function submitSetupUrl() {
  await act(async () => {
    document.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
  })
}
it('shares the self-host guide and setup URL workflow without entering managed hosting', async () => {
  const openGuide = vi.fn(),
    register = vi.fn(async () => 'https://self.test')
  render(flow({onOpenSetupGuide: openGuide, onRegister: register}))
  click('Custom domain')
  click('Self Host on Your Own Server')
  click('Open Setup Guide')
  expect(openGuide).toHaveBeenCalledOnce()
  click('My Setup URL is Ready')
  await changeSetupUrl('https://self.test/hm/register?secret=setup-secret')
  await submitSetupUrl()
  expect(register).toHaveBeenCalledWith('https://self.test/hm/register?secret=setup-secret')
  expect(document.body.textContent).toContain('Published to self.test!')
  expect(document.querySelector('input')).toBeNull()
})
it('locks setup input, back and dialog closure until the single registration finishes', async () => {
  let finish!: (url: string) => void
  const register = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      }),
  )
  const protect = vi.fn()
  render(flow({onRegister: register, setDialogCloseProtection: protect}))
  click('Custom domain')
  click('Paste a Hosting Setup URL')
  await changeSetupUrl('https://self.test/hm/register?secret=setup-secret')
  await act(async () => {
    const form = document.querySelector('form')!
    form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
    form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
  })
  expect(register).toHaveBeenCalledOnce()
  expect(document.querySelector('input')?.disabled).toBe(true)
  expect((document.querySelector('[aria-label="Back"]') as HTMLButtonElement).disabled).toBe(true)
  expect(protect).toHaveBeenLastCalledWith({preventClose: true, showCloseButton: false})
  await act(async () => finish('https://self.test'))
  expect(protect).toHaveBeenLastCalledWith({preventClose: false, showCloseButton: true})
})
it('retains setup input after failure, unlocks retry, and completes without closing automatically', async () => {
  const register = vi
    .fn()
    .mockRejectedValueOnce(new Error('Registration failed'))
    .mockResolvedValueOnce('https://self.test')
  const close = vi.fn()
  render(flow({onRegister: register, onClose: close}))
  click('Custom domain')
  click('Paste a Hosting Setup URL')
  const url = 'https://self.test/hm/register?secret=setup-secret'
  await changeSetupUrl(url)
  await submitSetupUrl()
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Registration failed')
  expect(document.querySelector('input')?.value).toBe(url)
  expect(document.querySelector('input')?.disabled).toBe(false)
  await submitSetupUrl()
  expect(register).toHaveBeenCalledTimes(2)
  expect(close).not.toHaveBeenCalled()
  click('Done')
  expect(close).toHaveBeenCalledOnce()
})
it('rejects unsafe setup URL protocols before invoking the platform adapter', async () => {
  const register = vi.fn()
  render(flow({onRegister: register}))
  click('Custom domain')
  click('Paste a Hosting Setup URL')
  await changeSetupUrl('javascript:alert(1)')
  await submitSetupUrl()
  expect(register).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('valid hosting setup URL')
})
it('keeps free and custom managed-hosting intent distinct', () => {
  render(flow())
  click('Free seed.test domain')
  expect(document.body.textContent).toContain('Hosted free')
  // A fresh dialog starts a new publishing workflow.
  render(<React.Fragment key="new">{flow()}</React.Fragment>)
  click('Custom domain')
  click('Hosting by Seed Hypermedia')
  expect(document.body.textContent).toContain('Hosted custom')
})
