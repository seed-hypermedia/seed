import {createGrpcWebTransport} from '@connectrpc/connect-web'
import {loggingInterceptor} from '@shm/shared'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import {createGRPCClient} from '@shm/shared/grpc-client'

const transport = createGrpcWebTransport({
  baseUrl: DAEMON_HTTP_URL,
  interceptors: [loggingInterceptor],
})

export const grpcClient = createGRPCClient(transport)
