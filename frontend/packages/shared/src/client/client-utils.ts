import {Code, ConnectError} from '@connectrpc/connect'

const REDACTED_MESSAGE = '[REDACTED]'
const SENSITIVE_RPC_METHODS = new Set([
  'Daemon.Authenticate',
  'Daemon.ExportKey',
  'Daemon.ImportKey',
  'Daemon.RegisterKey',
  'Daemon.GenMnemonic',
  'Daemon.SetVaultMasterPassword',
  'Daemon.StartVaultConnection',
])

/**
 * Reports whether an RPC method should have request payloads redacted from logs.
 */
export function isSensitiveRPCMethod(serviceTypeName: string, methodName: string): boolean {
  const serviceName = serviceTypeName.split('.').at(-1) || serviceTypeName
  return SENSITIVE_RPC_METHODS.has(`${serviceName}.${methodName}`)
}

/**
 * Reports whether quiet logging should skip an expected RPC error.
 */
export function shouldSuppressRPCErrorLog(methodName: string, error: unknown): boolean {
  if (process.env.QUIET_NODE_LOGS !== 'true') return false
  const connectError = ConnectError.from(error)
  return methodName === 'GetAccount' && connectError.code === Code.NotFound
}

function isVerboseLoggingEnabled(): boolean {
  return process.env.VERBOSE !== undefined
}

// @ts-expect-error - interceptor types from connect-web not imported for simplicity
export const loggingInterceptor = (next) => async (req) => {
  const isSensitive = isSensitiveRPCMethod(req.service.typeName, req.method.name)
  const requestMessage = isSensitive ? REDACTED_MESSAGE : req.message
  const slowRPC = setTimeout(() => {
    console.error(`🚨 SLOW RPC on ${req.method.name}`, requestMessage)
  }, 5000)
  try {
    if (isVerboseLoggingEnabled()) console.log(`↗️ to ${req.method.name}`, requestMessage)
    const result = await next(req)
    if (isVerboseLoggingEnabled()) {
      console.log(`🔃 to ${req.method.name}`, requestMessage, isSensitive ? REDACTED_MESSAGE : result?.message)
    }
    return result
  } catch (e) {
    if (!shouldSuppressRPCErrorLog(req.method.name, e)) {
      console.error(`🚨 to ${req.method.name}`, requestMessage, isSensitive ? REDACTED_MESSAGE : e)
    }
    throw e
  } finally {
    clearTimeout(slowRPC)
  }
}

// @ts-expect-error - interceptor types from connect-web not imported for simplicity
export const prodInter = (next) => async (req) => {
  const result = await next({
    ...req,
    init: {...req.init, redirect: 'follow'},
  })
  return result
}
