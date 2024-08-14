import {createPromiseClient, PromiseClient} from '@connectrpc/connect'
import {AccessControl, Daemon, Documents, Entities, Networking} from './client'

export type GRPCClient = {
  daemon: PromiseClient<typeof Daemon>
  documents: PromiseClient<typeof Documents>
  entities: PromiseClient<typeof Entities>
  networking: PromiseClient<typeof Networking>
  accessControl: PromiseClient<typeof AccessControl>
}

export function createGRPCClient(transport: any): GRPCClient {
  return {
    daemon: createPromiseClient(Daemon, transport),
    documents: createPromiseClient(Documents, transport),
    entities: createPromiseClient(Entities, transport),
    networking: createPromiseClient(Networking, transport),
    accessControl: createPromiseClient(AccessControl, transport),
  } as const
}
