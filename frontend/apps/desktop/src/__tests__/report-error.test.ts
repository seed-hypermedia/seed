import {Code, ConnectError} from '@connectrpc/connect'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const captureExceptionMock = vi.fn()
const setTagMock = vi.fn()
const setExtrasMock = vi.fn()
const toastErrorMock = vi.fn()

vi.mock('@sentry/electron/renderer', () => ({
  withScope: (cb: (scope: {setTag: typeof setTagMock; setExtras: typeof setExtrasMock}) => void) => {
    cb({setTag: setTagMock, setExtras: setExtrasMock})
  },
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}))

vi.mock('@shm/ui/toast', () => ({
  toast: {error: (...args: unknown[]) => toastErrorMock(...args)},
}))

beforeEach(() => {
  captureExceptionMock.mockClear()
  setTagMock.mockClear()
  setExtrasMock.mockClear()
  toastErrorMock.mockClear()
})

describe('reportError', () => {
  it('captures plain Error with feature/operation tags and extras, no toast', async () => {
    const {reportError} = await import('../errors')
    const err = new Error('boom')
    reportError(err, {feature: 'push-resource', operation: 'push-to-peer', host: 'site.example'})
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    expect(captureExceptionMock).toHaveBeenCalledWith(err)
    expect(setTagMock).toHaveBeenCalledWith('feature', 'push-resource')
    expect(setTagMock).toHaveBeenCalledWith('operation', 'push-to-peer')
    expect(setExtrasMock).toHaveBeenCalledWith({host: 'site.example'})
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('extracts ConnectError code into a connect_code tag', async () => {
    const {reportError} = await import('../errors')
    const err = new ConnectError('unavailable', Code.Unavailable)
    reportError(err, {feature: 'push-resource', operation: 'resolve-peer'})
    expect(setTagMock).toHaveBeenCalledWith('connect_code', String(Code.Unavailable))
    expect(captureExceptionMock).toHaveBeenCalledWith(err)
  })

  it('wraps non-Error inputs into an Error', async () => {
    const {reportError} = await import('../errors')
    reportError('plain string failure', {feature: 'misc', operation: 'noop'})
    const captured = captureExceptionMock.mock.calls[0]?.[0]
    expect(captured).toBeInstanceOf(Error)
    expect((captured as Error).message).toBe('plain string failure')
  })
})

describe('appError', () => {
  it('shows toast and delegates to reportError', async () => {
    const errors = await import('../errors')
    const original = new Error('original')
    errors.default('Failed to publish', {error: original, feature: 'publish', operation: 'commit'})
    expect(toastErrorMock).toHaveBeenCalledWith('Failed to publish')
    expect(captureExceptionMock).toHaveBeenCalledWith(original)
    expect(setTagMock).toHaveBeenCalledWith('feature', 'publish')
    expect(setTagMock).toHaveBeenCalledWith('operation', 'commit')
  })
})
