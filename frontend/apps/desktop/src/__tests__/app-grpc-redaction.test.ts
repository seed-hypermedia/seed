import {describe, expect, it, vi} from 'vitest'
import {loggingInterceptor, markGRPCReady} from '../app-grpc'
import * as log from '../logger'

describe('app-grpc loggingInterceptor', () => {
  it('redacts sensitive daemon payloads in error logs', async () => {
    markGRPCReady()

    const logErrorSpy = vi.spyOn(log, 'error').mockImplementation(() => {})
    const req = {
      service: {typeName: 'com.seed.daemon.v1alpha.Daemon'},
      method: {name: 'StartVaultConnection'},
      message: {password: 'secret-password'},
      init: {},
    }
    const next = vi.fn().mockRejectedValue(new Error('boom'))

    await expect(loggingInterceptor(next)(req as any)).rejects.toThrow('boom')

    const logged = JSON.stringify(logErrorSpy.mock.calls)
    expect(logged).toContain('[REDACTED]')
    expect(logged).not.toContain('secret-password')
  })
})
