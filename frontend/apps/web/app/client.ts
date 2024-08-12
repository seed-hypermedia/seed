import {createGrpcWebTransport} from "@connectrpc/connect-node";
import {createGRPCClient} from "@shm/shared/src/grpc-client";

export const transport = createGrpcWebTransport({
  baseUrl: "http://localhost:55001", // todo, better configuration
  httpVersion: "1.1",
});

export const queryClient = createGRPCClient(transport);
