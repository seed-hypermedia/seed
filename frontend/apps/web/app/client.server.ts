import {createGrpcWebTransport} from '@connectrpc/connect-node'
// import {loggingInterceptor} from '@shm/shared'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import {enablePreparedDocumentCache} from '@shm/shared/document-utils'
import {createGRPCClient} from '@shm/shared/grpc-client'
import {createDomainResolver} from '@shm/shared/models/domain-resolver'
import {getCurrentDaemonAuthToken} from './daemon-auth.server'

console.log('DAEMON_HTTP_URL', DAEMON_HTTP_URL)

// Every page render re-fetches the same documents (site home, breadcrumbs,
// embeds); reuse their JSON conversion + validation across requests. Versions
// are immutable, so entries never go stale. Nothing on the server mutates them.
enablePreparedDocumentCache(200)

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
