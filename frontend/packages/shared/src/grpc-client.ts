import {createPromiseClient, PromiseClient} from '@connectrpc/connect'
import {Accounts, Daemon, Documents, Entities, Networking} from './client'

export type GRPCClient = {
  accounts: PromiseClient<typeof Accounts>
  daemon: PromiseClient<typeof Daemon>
  documents: PromiseClient<typeof Documents>
  entities: PromiseClient<typeof Entities>
  networking: PromiseClient<typeof Networking>
}

export function createGRPCClient(transport: any): GRPCClient {
  return {
    accounts: createPromiseClient(Accounts, transport),
    daemon: createPromiseClient(Daemon, transport),
    documents: createPromiseClient(Documents, transport),
    entities: createPromiseClient(Entities, transport),
    networking: createPromiseClient(Networking, transport),
  } as const
}
