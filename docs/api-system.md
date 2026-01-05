# API System Architecture

The Seed Hypermedia application uses a unified, type-safe API system shared between web and desktop applications. This document explains the architecture, implementation details, and how to extend it.

## Overview

The API system provides:
- Type-safe request/response contracts using Zod schemas
- Shared implementation between Electron (desktop) and Remix (web)
- gRPC-based communication with the Go backend daemon
- Automatic serialization/deserialization for HTTP transport

## Core Files

| File | Purpose |
|------|---------|
| `@shm/shared/src/api.ts` | APIRouter registry mapping keys to implementations |
| `@shm/shared/src/api-types.ts` | Core types (HMRequestImplementation, HMRequestParams) |
| `@shm/shared/src/hm-types.ts` | Zod schemas for all HMRequest types |
| `frontend/apps/web/app/routes/api.$.tsx` | HTTP endpoint handler for web |
| `@shm/shared/src/grpc-client.ts` | gRPC client factory |

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  Desktop App    │     │    Web App      │
│   (Electron)    │     │    (Remix)      │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │ direct call           │ HTTP /api/{key}?params
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────┐
│            APIRouter                     │
│   (maps keys to implementations)        │
└────────────────┬────────────────────────┘
                 │
                 │ getData(grpcClient, input, queryDaemon)
                 ▼
┌─────────────────────────────────────────┐
│         HMRequestImplementation         │
│   (api-resource.ts, api-comment.ts...)  │
└────────────────┬────────────────────────┘
                 │
                 │ gRPC calls
                 ▼
┌─────────────────────────────────────────┐
│            GRPCClient                   │
│   (documents, comments, entities, etc)  │
└────────────────┬────────────────────────┘
                 │
                 │ Connect-RPC
                 ▼
┌─────────────────────────────────────────┐
│          Go Backend Daemon              │
│        (seed-daemon / seed-site)        │
└─────────────────────────────────────────┘
```

## Request Type Definition

Each API endpoint is defined as a Zod schema with three parts:

```typescript
// In hm-types.ts
export const HMAccountRequestSchema = z.object({
  key: z.literal('Account'),           // Unique key for routing
  input: z.string(),                   // Input type (account UID)
  output: HMMetadataPayloadSchema,     // Output type (metadata)
})
export type HMAccountRequest = z.infer<typeof HMAccountRequestSchema>
```

All request schemas are combined into a discriminated union:

```typescript
export const HMRequestSchema = z.discriminatedUnion('key', [
  HMResourceRequestSchema,
  HMAccountRequestSchema,
  HMCommentRequestSchema,
  // ... all other request schemas
])
export type HMRequest = z.infer<typeof HMRequestSchema>
```

## Implementation Pattern

Each API endpoint has a corresponding implementation file:

```typescript
// In api-account.ts
import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMAccountRequest, HMMetadataPayload} from './hm-types'

export const Account: HMRequestImplementation<HMAccountRequest> = {
  async getData(
    grpcClient: GRPCClient,
    input: string,
  ): Promise<HMMetadataPayload> {
    // Implementation using gRPC client
    const grpcAccount = await grpcClient.documents.getAccount({id: input})
    // Transform and return...
  },
}
```

The implementation is registered in the APIRouter:

```typescript
// In api.ts
export const APIRouter = {
  Resource,
  Account,
  Comment,
  // ... all implementations
} as const satisfies {
  [K in HMRequest as K['key']]: HMRequestImplementation<K>
}
```

## Web HTTP Handler

The web app exposes APIs via a Remix splat route:

```typescript
// In api.$.tsx
export async function loader({request, params}: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const key = params['*']?.split('/')[0]

  // Get implementation from router
  const apiDefinition = APIRouter[key as HMRequest['key']]

  // Find matching schema for validation
  const requestSchema = HMRequestSchema.options.find(
    (schema) => schema.shape.key.value === key,
  )

  // Deserialize input from query string
  const input = deserializeQueryString(url.search, requestSchema.shape.input)

  // Execute handler
  const output = await apiDefinition.getData(grpcClient, input, queryDaemon)

  // Validate and return
  const validatedOutput = requestSchema.shape.output.parse(output)
  return wrapJSON(validatedOutput)
}
```

## Custom Parameter Serialization

Some APIs need custom serialization (e.g., for complex IDs):

```typescript
// In api-resource.ts
export const ResourceParams: HMRequestParams<HMResourceRequest> = {
  inputToParams: (input: UnpackedHypermediaId) => ({id: packHmId(input)}),
  paramsToInput: (params: Record<string, string>) => {
    const id = unpackHmId(params.id)
    if (!id) throw new Error(`Invalid id query param: ${params.id}`)
    return id
  },
}

// Register in api.ts
export const APIParams: {
  [K in HMRequest['key']]?: HMRequestParams<Extract<HMRequest, {key: K}>>
} = {
  Account: AccountParams,
  Resource: ResourceParams,
  ResourceMetadata: ResourceMetadataParams,
}
```

## Query Daemon Function

Some APIs need direct HTTP access to the daemon (bypassing gRPC):

```typescript
// In api-get-cid.ts
export const GetCID: HMRequestImplementation<HMGetCIDRequest> = {
  async getData(_grpcClient, input, queryDaemon?: QueryDaemonFn) {
    if (!queryDaemon) {
      throw new Error('GetCID requires queryDaemon to be provided')
    }
    // Direct HTTP call to daemon debug endpoint
    const result = await queryDaemon<any>(`/debug/cid/${input.cid}`)
    return {value: result}
  },
}
```

## gRPC Client

The gRPC client provides access to all backend services:

```typescript
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
  resources: PromiseClient<typeof Resources>
}
```

## Adding a New API Endpoint

### Step 1: Define the Schema

In `hm-types.ts`:

```typescript
// Define input schema
export const HMMyNewInputSchema = z.object({
  someParam: z.string(),
  optionalParam: z.number().optional(),
})
export type HMMyNewInput = z.infer<typeof HMMyNewInputSchema>

// Define output schema
export const HMMyNewOutputSchema = z.object({
  result: z.string(),
  items: z.array(z.string()),
})
export type HMMyNewOutput = z.infer<typeof HMMyNewOutputSchema>

// Define request schema
export const HMMyNewRequestSchema = z.object({
  key: z.literal('MyNew'),
  input: HMMyNewInputSchema,
  output: HMMyNewOutputSchema,
})
export type HMMyNewRequest = z.infer<typeof HMMyNewRequestSchema>
```

### Step 2: Add to Discriminated Union

```typescript
export const HMRequestSchema = z.discriminatedUnion('key', [
  // ... existing schemas
  HMMyNewRequestSchema,
])
```

### Step 3: Create Implementation

Create `api-my-new.ts`:

```typescript
import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMMyNewRequest} from './hm-types'

export const MyNew: HMRequestImplementation<HMMyNewRequest> = {
  async getData(grpcClient: GRPCClient, input) {
    // Your implementation
    const result = await grpcClient.someService.someMethod({
      param: input.someParam,
    })

    return {
      result: result.value,
      items: result.items.map(i => i.name),
    }
  },
}
```

### Step 4: Register in Router

In `api.ts`:

```typescript
import {MyNew} from './api-my-new'

export const APIRouter = {
  // ... existing implementations
  MyNew,
} as const satisfies {
  [K in HMRequest as K['key']]: HMRequestImplementation<K>
}
```

### Step 5: (Optional) Custom Serialization

If your input needs special URL serialization:

```typescript
export const MyNewParams: HMRequestParams<HMMyNewRequest> = {
  inputToParams: (input) => ({
    someParam: input.someParam,
    optionalParam: input.optionalParam?.toString() ?? '',
  }),
  paramsToInput: (params) => ({
    someParam: params.someParam!,
    optionalParam: params.optionalParam ? parseInt(params.optionalParam) : undefined,
  }),
}

// In api.ts
export const APIParams = {
  // ... existing params
  MyNew: MyNewParams,
}
```

## Usage Examples

### From Web (via API route)

```typescript
// Fetch resource metadata
const response = await fetch('/api/Resource?id=hm://z6Mk...')
const resource = await response.json()

// Search entities
const searchParams = new URLSearchParams({
  query: 'search term',
  accountUid: 'z6Mk...',
})
const response = await fetch(`/api/Search?${searchParams}`)
```

### From Desktop (direct call)

```typescript
import {APIRouter} from '@shm/shared/api'

const result = await APIRouter.Account.getData(grpcClient, 'z6Mk...')
```

### From Notify Service

```typescript
import {requestAPI} from './notify-request'

// Type-safe API calls
const account = await requestAPI('Account', 'z6Mk...')
const resource = await requestAPI('Resource', hmId('z6Mk...', {path: ['doc']}))
```

## Error Handling

Errors are caught and returned as JSON with 500 status:

```typescript
catch (error) {
  return withCors(
    new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {status: 500, headers: {'Content-Type': 'application/json'}},
    ),
  )
}
```

## CORS

All API responses include CORS headers via `withCors()`:

```typescript
export function withCors(response: Response): Response {
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return response
}
```
