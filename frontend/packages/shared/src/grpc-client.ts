import {createPromiseClient, PromiseClient} from '@connectrpc/connect'
import {
  AccessControl,
  ActivityFeed,
  Comments,
  Daemon,
  Documents,
  Entities,
  Invoices,
  Networking,
  Subscriptions,
  Wallets,
} from './client'

export type GRPCClient = {
  activityFeed: PromiseClient<typeof ActivityFeed>
  daemon: PromiseClient<typeof Daemon>
  comments: PromiseClient<typeof Comments>
  documents: PromiseClient<typeof Documents>
  entities: PromiseClient<typeof Entities>
  networking: PromiseClient<typeof Networking>
  accessControl: PromiseClient<typeof AccessControl>
  subscriptions: PromiseClient<typeof Subscriptions>
  wallets: PromiseClient<typeof Wallets>
  invoices: PromiseClient<typeof Invoices>
}

export function createGRPCClient(transport: any): GRPCClient {
  return {
    activityFeed: createPromiseClient(ActivityFeed, transport),
    daemon: createPromiseClient(Daemon, transport),
    comments: createPromiseClient(Comments, transport),
    documents: createPromiseClient(Documents, transport),
    entities: createPromiseClient(Entities, transport),
    networking: createPromiseClient(Networking, transport),
    accessControl: createPromiseClient(AccessControl, transport),
    subscriptions: createPromiseClient(Subscriptions, transport),
    wallets: createPromiseClient(Wallets, transport),
    invoices: createPromiseClient(Invoices, transport),
  } as const
}
