import {Code, ConnectError} from '@connectrpc/connect'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {isSensitiveRPCMethod, loggingInterceptor, shouldSuppressRPCErrorLog} from './client-utils'

describe('isSensitiveRPCMethod', () => {
  it('matches sensitive daemon methods by service and method', () => {
    expect(isSensitiveRPCMethod('com.seed.daemon.v1alpha.Daemon', 'ExportKey')).toBe(true)
    expect(isSensitiveRPCMethod('com.seed.daemon.v1alpha.Daemon', 'ImportKey')).toBe(true)
    expect(isSensitiveRPCMethod('com.seed.daemon.v1alpha.Daemon', 'RegisterKey')).toBe(true)
    expect(isSensitiveRPCMethod('com.seed.daemon.v1alpha.Daemon', 'GenMnemonic')).toBe(true)
    expect(isSensitiveRPCMethod('com.seed.daemon.v1alpha.Daemon', 'StartVaultConnection')).toBe(true)
    expect(isSensitiveRPCMethod('com.seed.daemon.v1alpha.Daemon', 'ListKeys')).toBe(false)
  })
})

describe('loggingInterceptor redaction', () => {
  const originalQuietNodeLogs = process.env.QUIET_NODE_LOGS

  afterEach(() => {
    process.env.QUIET_NODE_LOGS = originalQuietNodeLogs
  })

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

  it('suppresses expected GetAccount not-found errors when quiet node logs are enabled', async () => {
    process.env.QUIET_NODE_LOGS = 'true'
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const req = {
      service: {typeName: 'com.seed.documents.v3alpha.Documents'},
      method: {name: 'GetAccount'},
      message: {id: 'z6Missing'},
      init: {},
    }
    const error = new ConnectError('account z6Missing is not found', Code.NotFound)
    const next = vi.fn().mockRejectedValue(error)

    await expect(loggingInterceptor(next)(req as any)).rejects.toThrow(error)
    expect(consoleError).not.toHaveBeenCalled()
  })
})

describe('shouldSuppressRPCErrorLog', () => {
  const originalQuietNodeLogs = process.env.QUIET_NODE_LOGS

  afterEach(() => {
    process.env.QUIET_NODE_LOGS = originalQuietNodeLogs
  })

  it('only suppresses GetAccount not-found errors when quiet node logs are enabled', () => {
    process.env.QUIET_NODE_LOGS = 'true'
    expect(shouldSuppressRPCErrorLog('GetAccount', new ConnectError('not found', Code.NotFound))).toBe(true)
    expect(shouldSuppressRPCErrorLog('GetAccount', new ConnectError('internal', Code.Internal))).toBe(false)
    expect(shouldSuppressRPCErrorLog('GetDocument', new ConnectError('not found', Code.NotFound))).toBe(false)
  })

  it('does not suppress GetAccount not-found errors unless quiet node logs are true', () => {
    process.env.QUIET_NODE_LOGS = '1'
    expect(shouldSuppressRPCErrorLog('GetAccount', new ConnectError('not found', Code.NotFound))).toBe(false)
  })
})
