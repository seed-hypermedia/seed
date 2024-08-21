import {createGrpcWebTransport} from "@connectrpc/connect-node";
import {API_HTTP_URL} from "@shm/shared";
import {createGRPCClient} from "@shm/shared/src/grpc-client";

export const transport = createGrpcWebTransport({
  baseUrl: API_HTTP_URL || "http://localhost:56001",
  httpVersion: "1.1",
});

export const queryClient = createGRPCClient(transport);
