import {createPromiseClient, PromiseClient} from '@connectrpc/connect'
import {
  Accounts,
  Changes,
  Comments,
  ContentGraph,
  Daemon,
  Documents,
  Entities,
  Networking,
} from './client'

export type GRPCClient = {
  accounts: PromiseClient<typeof Accounts>
  changes: PromiseClient<typeof Changes>
  comments: PromiseClient<typeof Comments>
  contentGraph: PromiseClient<typeof ContentGraph>
  daemon: PromiseClient<typeof Daemon>
  documents: PromiseClient<typeof Documents>
  entities: PromiseClient<typeof Entities>
  networking: PromiseClient<typeof Networking>
}

export function createGRPCClient(transport: any): GRPCClient {
  return {
    accounts: createPromiseClient(Accounts, transport),
    changes: createPromiseClient(Changes, transport),
    comments: createPromiseClient(Comments, transport),
    contentGraph: createPromiseClient(ContentGraph, transport),
    daemon: createPromiseClient(Daemon, transport),
    documents: createPromiseClient(Documents, transport),
    entities: createPromiseClient(Entities, transport),
    networking: createPromiseClient(Networking, transport),
  } as const
}
