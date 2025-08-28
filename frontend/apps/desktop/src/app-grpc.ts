import type {Interceptor} from '@connectrpc/connect'
import {createGrpcWebTransport} from '@connectrpc/connect-node'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import {createGRPCClient} from '@shm/shared/grpc-client'
import {connectionMonitor} from './network-debug'
import * as log from './logger'
import {randomUUID} from 'crypto'

let isGrpcReady = false

const loggingInterceptor: Interceptor = (next) => async (req) => {
  const requestId = randomUUID()
  const startTime = Date.now()
  
  connectionMonitor.trackRequest(requestId, req.method.name)
  log.debug(`🚀 Starting ${req.method.name}`, {requestId})
  
  try {
    const result = await next(req)
    const duration = Date.now() - startTime
    connectionMonitor.completeRequest(requestId, true)
    log.debug(`✅ ${req.method.name} completed`, {requestId, duration})
    // @ts-ignore
    // log.debug(`🔃 to ${req.method.name} `, req.message, result?.message)
    return result
  } catch (e: any) {
    const duration = Date.now() - startTime
    connectionMonitor.completeRequest(requestId, false)
    log.error(`❌ ${req.method.name} failed`, {requestId, duration, error: e.message})
    
    if (!isGrpcReady) throw e
    let error = e

    if (e.message.match('stream.getReader is not a function')) {
      error = new Error('RPC broken, try running yarn and ./dev gen')
    } else {
      log.error(`🚨 ${req.method.name} error`, {message: req.message, error})
    }
    throw error
  }
}

const prodInter: Interceptor = (next) => async (req) => {
  const result = await next({
    ...req,
    init: {
      ...req.init, 
      redirect: 'follow',
      // Add timeout to prevent hanging requests
      signal: AbortSignal.timeout(30000), // 30 second timeout
    },
  }).catch((e) => {
    log.error(`🌐 Network error for ${req.method.name}`, {
      message: e.message,
      cause: e.cause,
      stack: e.stack?.slice(0, 200)
    })
    
    if (!isGrpcReady) throw e
    if (e.message.match('fetch failed') && e.stack?.join('').match('undici')) {
      log.error('🚨 Mysterious Undici Error via ConnectWeb - possible connection pool issue')
      log.error('Undici error details', {error: e})
      // Consider restarting daemon connection here
    }
    
    if (e.name === 'TimeoutError' || e.message.match('timeout')) {
      log.warn('⏰ Request timed out - daemon may be overloaded')
    }
    
    throw e
  })
  return result
}

export function markGRPCReady() {
  isGrpcReady = true
}

const IS_DEV = process.env.NODE_ENV == 'development'
const DEV_INTERCEPTORS = [loggingInterceptor, prodInter]

export const transport = createGrpcWebTransport({
  baseUrl: DAEMON_HTTP_URL,
  httpVersion: '1.1',
  interceptors: IS_DEV ? DEV_INTERCEPTORS : [prodInter],
})

export const grpcClient = createGRPCClient(transport)
