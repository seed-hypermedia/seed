import {createGrpcWebTransport} from '@connectrpc/connect-web'
import {
  createGRPCClient,
  DAEMON_HTTP_URL,
  loggingInterceptor,
} from '@shm/shared'

const transport = createGrpcWebTransport({
  baseUrl: DAEMON_HTTP_URL,
  interceptors: [loggingInterceptor],
})

export const grpcClient = createGRPCClient(transport)
