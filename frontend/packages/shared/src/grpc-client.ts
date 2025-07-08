import {createPromiseClient, PromiseClient} from '@connectrpc/connect'
import {
  AccessControl,
  ActivityFeed,
  ConnectedAccounts,
  ConnectedAccountsPrices,
  ConnectedAccountProducts,
  ConnectedCustomers,
  Comments,
  Daemon,
  Documents,
  Entities,
  Invoices,
  Networking,
  PlatformAccounts,
  PlatformPrices,
  PlatformProducts,
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

export type PayGRPCClient = {
  connectedAccounts: PromiseClient<typeof ConnectedAccounts.Accounts>
  connectedAccountsStatus: PromiseClient<typeof ConnectedAccounts.Status>
  connectedAccountsPayments: PromiseClient<typeof ConnectedAccounts.Payments>
  connectedAccountsPrices: PromiseClient<typeof ConnectedAccountsPrices.Prices>
  connectedAccountProducts: PromiseClient<
    typeof ConnectedAccountProducts.Products
  >
  customers: PromiseClient<typeof ConnectedCustomers.Customers>
  customersPayments: PromiseClient<typeof ConnectedCustomers.Payments>
  platformAccounts: PromiseClient<typeof PlatformAccounts.Accounts>
  platformPrices: PromiseClient<typeof PlatformPrices.Prices>
  platformProducts: PromiseClient<typeof PlatformProducts.Products>
}

export function createPayGRPCClient(transport: any): PayGRPCClient {
  return {
    connectedAccounts: createPromiseClient(
      ConnectedAccounts.Accounts,
      transport,
    ),
    connectedAccountsStatus: createPromiseClient(
      ConnectedAccounts.Status,
      transport,
    ),
    connectedAccountsPayments: createPromiseClient(
      ConnectedAccounts.Payments,
      transport,
    ),
    customersPayments: createPromiseClient(
      ConnectedCustomers.Payments,
      transport,
    ),
    connectedAccountsPrices: createPromiseClient(
      ConnectedAccountsPrices.Prices,
      transport,
    ),
    connectedAccountProducts: createPromiseClient(
      ConnectedAccountProducts.Products,
      transport,
    ),
    customers: createPromiseClient(ConnectedCustomers.Customers, transport),
    platformAccounts: createPromiseClient(PlatformAccounts.Accounts, transport),
    platformPrices: createPromiseClient(PlatformPrices.Prices, transport),
    platformProducts: createPromiseClient(PlatformProducts.Products, transport),
  } as const
}
