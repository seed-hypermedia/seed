import {createGrpcWebTransport} from "@connectrpc/connect-node";
import {DAEMON_HTTP_URL} from "@shm/shared/constants";
import {createGRPCClient} from "@shm/shared/grpc-client";

export const transport = createGrpcWebTransport({
  baseUrl: DAEMON_HTTP_URL,
  httpVersion: "1.1",
});

export const queryClient = createGRPCClient(transport);
