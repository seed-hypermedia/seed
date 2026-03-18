import {describe, expect, it, vi} from 'vitest'
import {isSensitiveRPCMethod, loggingInterceptor} from './client-utils'

describe('isSensitiveRPCMethod', () => {
  it('matches sensitive daemon methods by service and method', () => {
    expect(isSensitiveRPCMethod('com.seed.daemon.v1alpha.Daemon', 'ExportKey')).toBe(true)
    expect(isSensitiveRPCMethod('com.seed.daemon.v1alpha.Daemon', 'ImportKey')).toBe(true)
    expect(isSensitiveRPCMethod('com.seed.daemon.v1alpha.Daemon', 'RegisterKey')).toBe(true)
    expect(isSensitiveRPCMethod('com.seed.daemon.v1alpha.Daemon', 'GenMnemonic')).toBe(true)
    expect(isSensitiveRPCMethod('com.seed.daemon.v1alpha.Daemon', 'ListKeys')).toBe(false)
  })
})

describe('loggingInterceptor redaction', () => {
  it('redacts sensitive request bodies on errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const secretPayload = {password: 'super-secret'}
    const req = {
      service: {typeName: 'com.seed.daemon.v1alpha.Daemon'},
      method: {name: 'ExportKey'},
      message: secretPayload,
      init: {},
    }
    const next = vi.fn().mockRejectedValue(new Error('boom'))

    await expect(loggingInterceptor(next)(req as any)).rejects.toThrow('boom')
    expect(consoleError).toHaveBeenCalled()
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('super-secret')
    expect(JSON.stringify(consoleError.mock.calls)).toContain('[REDACTED]')
  })
})
