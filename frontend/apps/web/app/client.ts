import {createGrpcWebTransport} from "@connectrpc/connect-node";
import {DAEMON_HTTP_URL} from "@shm/shared";
import {createGRPCClient} from "@shm/shared/src/grpc-client";

console.log("DAEMON_HTTP_URL", DAEMON_HTTP_URL);

export const transport = createGrpcWebTransport({
  baseUrl: DAEMON_HTTP_URL,
  httpVersion: "1.1",
});

export const queryClient = createGRPCClient(transport);
