import {createPromiseClient, PromiseClient} from '@connectrpc/connect'
import {
  AccessControl,
  Comments,
  Daemon,
  Documents,
  Entities,
  Networking,
  Subscriptions,
} from './client'

export type GRPCClient = {
  daemon: PromiseClient<typeof Daemon>
  comments: PromiseClient<typeof Comments>
  documents: PromiseClient<typeof Documents>
  entities: PromiseClient<typeof Entities>
  networking: PromiseClient<typeof Networking>
  accessControl: PromiseClient<typeof AccessControl>
  subscriptions: PromiseClient<typeof Subscriptions>
}

export function createGRPCClient(transport: any): GRPCClient {
  return {
    daemon: createPromiseClient(Daemon, transport),
    comments: createPromiseClient(Comments, transport),
    documents: createPromiseClient(Documents, transport),
    entities: createPromiseClient(Entities, transport),
    networking: createPromiseClient(Networking, transport),
    accessControl: createPromiseClient(AccessControl, transport),
    subscriptions: createPromiseClient(Subscriptions, transport),
  } as const
}
