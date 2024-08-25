import {createGrpcWebTransport} from "@connectrpc/connect-node";
import {createGRPCClient} from "@shm/shared/src/grpc-client";

export const transport = createGrpcWebTransport({
  // baseUrl: process.env.WEB_GRPC_HOST || "http://localhost:55001",
  baseUrl: "http://localhost:56001",
  httpVersion: "1.1",
});

export const queryClient = createGRPCClient(transport);
