// @vitest-environment jsdom
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  APPROVE_ARM_DELAY_MS,
  SignConfirmDialogContent,
  type SignConfirmRequest,
} from '../extensions/sign-confirm-dialog'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const request: SignConfirmRequest = {
  extension: {id: 'hm://z6MkAuthor/kanban', name: 'Kanban', version: 'bafyExt'},
  site: {uid: 'z6MkpTHzQyPsLa6Vn2XZbbvDQZmyAkgMSjT8fMXk1NoMFSGh', name: 'Site'},
  account: {accountId: 'z6MkgY6SDHqU6TpGZtbfGi6qrHdT2hzWFHbtx7gJ3bEbn9kM', name: 'Alice'},
  detail: {kind: 'data', purpose: 'login', byteLength: 2, hexPreview: '6869'},
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

function render(req: SignConfirmRequest, approve = vi.fn(), onClose = vi.fn()) {
  act(() => {
    root.render(<SignConfirmDialogContent input={{request: req, approve}} onClose={onClose} />)
  })
  return {approve, onClose}
}

const approveButton = () => container.querySelector('[data-testid="extension-sign-approve"]') as HTMLButtonElement
const denyButton = () => container.querySelector('[data-testid="extension-sign-deny"]') as HTMLButtonElement

describe('SignConfirmDialogContent', () => {
  it('keeps Approve inert until the arming delay has passed; Deny is focused and works at once', () => {
    const {approve, onClose} = render(request)
    expect(approveButton().disabled).toBe(true)
    expect(document.activeElement).toBe(denyButton())

    act(() => {
      approveButton().click()
    })
    expect(approve).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(APPROVE_ARM_DELAY_MS - 1)
    })
    expect(approveButton().disabled).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(approveButton().disabled).toBe(false)
    act(() => {
      approveButton().click()
    })
    expect(approve).toHaveBeenCalledWith({allowSession: false})

    act(() => {
      denyButton().click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('warns when developer override code is asking', () => {
    render({...request, extension: {...request.extension, devUrl: 'http://localhost:5181'}})
    const warning = container.querySelector('[data-testid="extension-sign-dev-warning"]')
    expect(warning?.textContent).toContain('developer override code')
    expect(warning?.textContent).toContain('http://localhost:5181')
    render(request)
    expect(container.querySelector('[data-testid="extension-sign-dev-warning"]')).toBeNull()
  })

  it('explains why it appeared despite a session grant', () => {
    render({...request, sessionAllowBypassed: true})
    expect(container.querySelector('[data-testid="extension-sign-bypass-note"]')?.textContent).toContain(
      'always confirmed',
    )
    render(request)
    expect(container.querySelector('[data-testid="extension-sign-bypass-note"]')).toBeNull()
  })
})
