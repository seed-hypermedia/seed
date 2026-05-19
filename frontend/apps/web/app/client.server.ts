import {createGrpcWebTransport} from '@connectrpc/connect-node'
// import {loggingInterceptor} from '@shm/shared'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import {createGRPCClient} from '@shm/shared/grpc-client'
import {createDomainResolver} from '@shm/shared/models/domain-resolver'
import {getCurrentDaemonAuthToken} from './daemon-auth.server'

console.log('DAEMON_HTTP_URL', DAEMON_HTTP_URL)

export const transport = createGrpcWebTransport({
  baseUrl: DAEMON_HTTP_URL,
  httpVersion: '1.1',
  interceptors: [
    (next) => async (req) => {
      const token = getCurrentDaemonAuthToken()
      if (token) {
        req.header.set('Authorization', `Bearer ${token}`)
      }
      return next(req)
    },
  ],
})

export const grpcClient = createGRPCClient(transport)

export const domainResolver = createDomainResolver(grpcClient)
