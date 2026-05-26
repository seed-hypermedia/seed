import {Code, ConnectError} from '@connectrpc/connect'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const captureExceptionMock = vi.fn()
const setTagMock = vi.fn()
const setExtrasMock = vi.fn()

vi.mock('@sentry/remix', () => ({
  withScope: (cb: (scope: {setTag: typeof setTagMock; setExtras: typeof setExtrasMock}) => void) => {
    cb({setTag: setTagMock, setExtras: setExtrasMock})
  },
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}))

beforeEach(() => {
  captureExceptionMock.mockClear()
  setTagMock.mockClear()
  setExtrasMock.mockClear()
})

describe('reportError (web)', () => {
  it('captures plain Error with feature/operation tags and extras', async () => {
    const {reportError} = await import('./report-error')
    const err = new Error('boom')
    reportError(err, {feature: 'web-comment', operation: 'publish', docId: 'hm://doc'})
    expect(captureExceptionMock).toHaveBeenCalledWith(err)
    expect(setTagMock).toHaveBeenCalledWith('feature', 'web-comment')
    expect(setTagMock).toHaveBeenCalledWith('operation', 'publish')
    expect(setExtrasMock).toHaveBeenCalledWith({docId: 'hm://doc'})
  })

  it('extracts ConnectError code', async () => {
    const {reportError} = await import('./report-error')
    const err = new ConnectError('nope', Code.NotFound)
    reportError(err, {feature: 'api', operation: 'load'})
    expect(setTagMock).toHaveBeenCalledWith('connect_code', String(Code.NotFound))
  })

  it('wraps non-Error inputs', async () => {
    const {reportError} = await import('./report-error')
    reportError({weird: 'object'}, {feature: 'misc', operation: 'noop'})
    const captured = captureExceptionMock.mock.calls[0]?.[0]
    expect(captured).toBeInstanceOf(Error)
  })
})
