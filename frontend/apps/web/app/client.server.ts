import {createGrpcWebTransport} from '@connectrpc/connect-node'
// import {loggingInterceptor} from '@shm/shared'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import {createGRPCClient} from '@shm/shared/grpc-client'

console.log('DAEMON_HTTP_URL', DAEMON_HTTP_URL)

export const transport = createGrpcWebTransport({
  baseUrl: DAEMON_HTTP_URL,
  httpVersion: '1.1',
  // interceptors: [loggingInterceptor],
})

export const grpcClient = createGRPCClient(transport)
