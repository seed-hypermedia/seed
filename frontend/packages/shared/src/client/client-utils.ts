const ENABLE_VERBOSE_LOGGING = process.env.VERBOSE === 'true'
const REDACTED_MESSAGE = '[REDACTED]'
const SENSITIVE_RPC_METHODS = new Set(['Daemon.ImportKey', 'Daemon.RegisterKey', 'Daemon.GenMnemonic'])

/**
 * Reports whether an RPC method should have request payloads redacted from logs.
 */
export function isSensitiveRPCMethod(serviceTypeName: string, methodName: string): boolean {
  const serviceName = serviceTypeName.split('.').at(-1) || serviceTypeName
  return SENSITIVE_RPC_METHODS.has(`${serviceName}.${methodName}`)
}

// @ts-expect-error - interceptor types from connect-web not imported for simplicity
export const loggingInterceptor = (next) => async (req) => {
  const isSensitive = isSensitiveRPCMethod(req.service.typeName, req.method.name)
  const timeout = setTimeout(() => {
    console.error(`🚨 TIMEOUT on ${req.method.name}`, isSensitive ? REDACTED_MESSAGE : req.message)
  }, 5000)
  try {
    if (ENABLE_VERBOSE_LOGGING) console.log(`↗️ to ${req.method.name}`, isSensitive ? REDACTED_MESSAGE : req.message)
    const result = await next(req)
    clearTimeout(timeout)
    if (ENABLE_VERBOSE_LOGGING) {
      console.log(`🔃 to ${req.method.name}`, isSensitive ? REDACTED_MESSAGE : req.message, result?.message)
    }
    return result
  } catch (e) {
    clearTimeout(timeout)
    console.error(
      `🚨 to ${req.method.name}`,
      isSensitive ? REDACTED_MESSAGE : req.message,
      isSensitive ? (e instanceof Error ? e.message : String(e)) : e,
    )
    throw e
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
