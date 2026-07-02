import {createPromiseClient} from '@connectrpc/connect'
import type {PromiseClient} from '@connectrpc/connect'
import {
  AccessControl,
  ActivityFeed,
  Comments,
  Daemon,
  Documents,
  Invoices,
  Networking,
  Resources,
  Subscriptions,
  Telemetry,
  Wallets,
} from './client'

/** Promise-based Connect clients grouped by Seed service. */
export type GRPCClient = {
  activityFeed: PromiseClient<typeof ActivityFeed>
  daemon: PromiseClient<typeof Daemon>
  comments: PromiseClient<typeof Comments>
  documents: PromiseClient<typeof Documents>
  networking: PromiseClient<typeof Networking>
  accessControl: PromiseClient<typeof AccessControl>
  subscriptions: PromiseClient<typeof Subscriptions>
  telemetry: PromiseClient<typeof Telemetry>
  wallets: PromiseClient<typeof Wallets>
  invoices: PromiseClient<typeof Invoices>
  resources: PromiseClient<typeof Resources>
}

/** Creates a grouped set of Promise clients for the provided Connect transport. */
export function createGRPCClient(transport: any): GRPCClient {
  return {
    activityFeed: createPromiseClient(ActivityFeed, transport),
    daemon: createPromiseClient(Daemon, transport),
    comments: createPromiseClient(Comments, transport),
    documents: createPromiseClient(Documents, transport),
    networking: createPromiseClient(Networking, transport),
    accessControl: createPromiseClient(AccessControl, transport),
    subscriptions: createPromiseClient(Subscriptions, transport),
    telemetry: createPromiseClient(Telemetry, transport),
    wallets: createPromiseClient(Wallets, transport),
    invoices: createPromiseClient(Invoices, transport),
    resources: createPromiseClient(Resources, transport),
  } as const
}
