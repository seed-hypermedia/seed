import {createGrpcWebTransport} from '@connectrpc/connect-web'
import {createGRPCClient, type GRPCClient} from '@shm/shared/grpc-client'

/** Creates a full gRPC-Web client for the Seed daemon. */
export function createClient(baseUrl: string): GRPCClient {
  const transport = createGrpcWebTransport({baseUrl})
  return createGRPCClient(transport)
}
