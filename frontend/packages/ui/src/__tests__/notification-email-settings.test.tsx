// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {NotificationEmailSettings, type NotificationEmailConfig} from '../notifications-page'
import {TooltipProvider} from '../tooltip'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// The gear's tooltip opens when focus returns to it after the dialog closes, and Radix positions it with a
// ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const noEmail: NotificationEmailConfig = {
  email: null,
  verifiedTime: null,
  verificationSendTime: null,
  verificationExpired: false,
}
const verifiedEmail: NotificationEmailConfig = {
  ...noEmail,
  email: 'me@example.com',
  verifiedTime: '2026-10-01T00:00:00Z',
}

function renderSettings(config: NotificationEmailConfig) {
  const props = {
    onSave: vi.fn(async (_email: string) => ({verified: false})),
    onRemove: vi.fn(async () => undefined),
    onResendVerification: vi.fn(async () => undefined),
  }
  act(() =>
    root.render(
      <TooltipProvider>
        <NotificationEmailSettings config={config} isLoading={false} {...props} />
      </TooltipProvider>,
    ),
  )
  return props
}

function open() {
  act(() => {
    container
      .querySelector('[aria-label="Email notifications"]')!
      .dispatchEvent(new MouseEvent('click', {bubbles: true}))
  })
}

function input() {
  return document.body.querySelector<HTMLInputElement>('#notification-email')!
}

function typeEmail(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input(), value)
    input().dispatchEvent(new Event('input', {bubbles: true}))
  })
}

function submitButton() {
  return document.body.querySelector<HTMLButtonElement>('button[type="submit"]')!
}

async function submit() {
  await act(async () => {
    input().form!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
  })
}

describe('NotificationEmailSettings', () => {
  it('sets a first email once the address is valid', async () => {
    const {onSave} = renderSettings(noEmail)
    open()
    expect(submitButton().textContent).toBe('Set email')
    expect(submitButton().disabled).toBe(true)

    typeEmail('not-an-email')
    expect(submitButton().disabled).toBe(true)
    expect(document.body.textContent).toContain('Enter a valid email address.')

    typeEmail('  new@example.com ')
    expect(submitButton().disabled).toBe(false)
    await submit()
    expect(onSave).toHaveBeenCalledWith('new@example.com')
  })

  it('opens prefilled and removes the email when the field is cleared and saved', async () => {
    const {onSave, onRemove} = renderSettings(verifiedEmail)
    open()
    expect(input().value).toBe('me@example.com')
    expect(submitButton().textContent).toBe('Save')
    // Saving the unchanged address does nothing.
    expect(submitButton().disabled).toBe(true)

    typeEmail('')
    await submit()
    expect(onRemove).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('flags an unconfirmed email on the gear and offers to send the confirmation again', async () => {
    const {onResendVerification} = renderSettings({...noEmail, email: 'me@example.com'})
    expect(container.textContent).toContain('Email waiting for confirmation')
    open()
    expect(document.body.textContent).toContain('Notifications are paused until you confirm this email.')
    const resend = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Send confirmation email',
    )!
    await act(async () => {
      resend.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    })
    expect(onResendVerification).toHaveBeenCalled()
  })

  it('shows no dot once the email is confirmed', () => {
    renderSettings(verifiedEmail)
    expect(container.textContent).not.toContain('Email waiting for confirmation')
  })
})
