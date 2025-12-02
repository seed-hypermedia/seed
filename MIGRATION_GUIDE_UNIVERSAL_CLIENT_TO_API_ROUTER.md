# Universal Client to API Router Migration Guide

This guide documents how to migrate legacy universal client methods (like `fetchResource`, `fetchAccount`, etc.) to the new unified API router pattern using `client.request()`.

## Overview

**Goal**: Migrate from platform-specific implementations (`fetchX` methods on `UniversalClient`) to a unified API router pattern that works consistently across desktop and web.

**Pattern**:
- **Before**: `client.fetchResource(id)`
- **After**: `client.request('Resource', id)` or `client.request<HMResourceRequest>('Resource', id)`

## Architecture

### The API Router Flow

1. **Desktop**: `client.request(key, input)` → `desktopRequest()` → `APIRouter[key].getData()` → gRPC client
2. **Web**: `client.request(key, input)` → HTTP `/api/{key}?{serialized input}` → Server `APIRouter[key].getData()` → gRPC client

### Key Files

- `frontend/packages/shared/src/api.ts` - Central router mapping keys to implementations
- `frontend/packages/shared/src/api-*.ts` - Individual API implementations
- `frontend/packages/shared/src/hm-types.ts` - Type definitions for requests/responses
- `frontend/packages/shared/src/universal-client.ts` - Interface definition
- `frontend/packages/shared/src/create-web-universal-client.tsx` - Web implementation
- `frontend/apps/desktop/src/desktop-universal-client.tsx` - Desktop implementation
- `frontend/apps/desktop/src/desktop-api.ts` - Desktop request handler
- `frontend/apps/web/app/routes/api.$.tsx` - Web API route handler

## Step-by-Step Migration Process

### Step 1: Define the Request/Response Types

In `frontend/packages/shared/src/hm-types.ts`:

```typescript
// Define the request schema
export const HMYourNewRequestSchema = z.object({
  key: z.literal('YourNewAPI'),  // This is the key used in APIRouter
  input: YourInputTypeSchema,     // Input type schema
  output: YourOutputTypeSchema,   // Output type schema
})
export type HMYourNewRequest = z.infer<typeof HMYourNewRequestSchema>

// Add to the discriminated union
export const HMRequestSchema = z.discriminatedUnion('key', [
  HMResourceRequestSchema,
  HMResourceMetadataRequestSchema,
  HMYourNewRequestSchema,  // Add your new request here
])
```

**Example from Resource migration:**
```typescript
export const HMResourceRequestSchema = z.object({
  key: z.literal('Resource'),
  input: unpackedHmIdSchema,
  output: HMResourceSchema,
})
```

### Step 2: Implement the API Handler

Create `frontend/packages/shared/src/api-{name}.ts`:

```typescript
import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMYourNewRequest, YourInputType, YourOutputType} from './hm-types'

export const YourNewAPI: HMRequestImplementation<HMYourNewRequest> = {
  async getData(
    grpcClient: GRPCClient,
    input: YourInputType,
  ): Promise<YourOutputType> {
    // Implementation here
    // You can reuse existing helper functions like createResourceFetcher(grpcClient)
    const result = await grpcClient.someService.someMethod(input)
    return result
  },
}
```

**Example from Resource migration:**
```typescript
export const Resource: HMRequestImplementation<HMResourceRequest> = {
  async getData(
    grpcClient: GRPCClient,
    input: UnpackedHypermediaId,
  ): Promise<HMResource> {
    const fetchResource = createResourceFetcher(grpcClient)
    return await fetchResource(input)
  },
}
```

### Step 3: Register in API Router

In `frontend/packages/shared/src/api.ts`:

```typescript
import {YourNewAPI} from './api-{name}'

export const APIRouter: APIRouterType = {
  Resource,
  ResourceMetadata,
  YourNewAPI,  // Add your new handler
}
```

### Step 4: Migrate All Callers

Find all usages of the old method:

```bash
grep -r "\.fetchYourOldMethod\(" frontend/
```

Update each caller from:
```typescript
const result = await client.fetchYourOldMethod(input)
```

To:
```typescript
const result = await client.request<HMYourNewRequest>('YourNewAPI', input)
```

**Common locations to check:**
- `frontend/packages/shared/src/models/*.ts` - Shared model hooks
- `frontend/apps/desktop/src/models/*.ts` - Desktop-specific hooks
- `frontend/apps/web/app/routes/*.tsx` - Web route loaders

**TypeScript Generic Parameter:**
If you encounter TypeScript inference issues with discriminated unions, explicitly provide the generic type:
```typescript
client.request<HMYourNewRequest>('YourNewAPI', input)
```

### Step 5: Remove from UniversalClient Interface

In `frontend/packages/shared/src/universal-client.ts`:

```typescript
export type UniversalClient = {
  // ... other methods

  // Remove this:
  // fetchYourOldMethod(input: InputType): Promise<OutputType>

  request<Request extends HMRequest>(
    key: Request['key'],
    input: Request['input'],
  ): Promise<Request['output']>
}
```

### Step 6: Remove Platform Implementations

**Desktop** - `frontend/apps/desktop/src/desktop-universal-client.tsx`:
```typescript
// Remove import
import {
  fetchAccount,
  // fetchYourOldMethod,  // Remove this
} from '@/models/entities'

// Remove from client object
export const desktopUniversalClient: UniversalClient = {
  // ... other methods
  // fetchYourOldMethod: fetchYourOldMethod,  // Remove this
  request: desktopRequest,
}
```

**Web** - `frontend/packages/shared/src/create-web-universal-client.tsx`:
```typescript
// Remove implementation
export function createWebUniversalClient(deps: WebClientDependencies): UniversalClient {
  return {
    // ... other methods

    // Remove this entire block:
    // fetchYourOldMethod: async (input) => {
    //   const url = `/hm/api/your-old-method/...`
    //   return deps.queryAPI<OutputType>(url)
    // },

    request: async <Req extends HMRequest>(...) => { ... },
  }
}
```

### Step 7: Verify and Test

```bash
# Build types
yarn workspace @shm/shared build:types

# Run tests
yarn workspace @shm/shared test run

# Type check entire project
yarn typecheck
```

## Common Issues & Solutions

### Issue 1: TypeScript Discriminated Union Inference

**Error**: "Property 'type' is missing" or "Two different types with this name exist"

**Solution**: Explicitly provide the generic type parameter:
```typescript
// Instead of:
await client.request('Resource', id)

// Use:
await client.request<HMResourceRequest>('Resource', id)
```

**Why**: TypeScript can't always infer discriminated union types through Zod's `.parse()` method across module boundaries. The explicit generic helps TypeScript narrow the return type correctly.

### Issue 2: Zod Schema Validation Type Mismatch

**Error**: Type returned from `schema.parse()` doesn't match expected type

**Solution**: Add type assertion after validation in `create-web-universal-client.tsx`:
```typescript
return requestSchema.shape.output.parse(response) as Req['output']
```

**Why**: Zod's inferred types and imported types may be seen as different by TypeScript even though they're structurally identical.

### Issue 3: Input Serialization for Web

**Issue**: Complex input types (nested objects, arrays) need special handling

**Solution**: The `serializeQueryString()` and `deserializeQueryString()` functions handle this automatically. Ensure your input schema is properly defined in `hm-types.ts`.

**Example**: `UnpackedHypermediaId` with nested objects is automatically serialized to query params.

## Testing Strategy

1. **Unit Tests**: Add tests in `frontend/packages/shared/src/__tests__/` if needed
2. **Type Tests**: Ensure `yarn workspace @shm/shared build:types` passes
3. **Integration Tests**: Test both desktop and web platforms manually
4. **Regression Tests**: Check existing tests still pass

## Migration Checklist

For each API you migrate:

- [ ] Step 1: Define request/response types in `hm-types.ts`
- [ ] Step 2: Create API handler in `api-{name}.ts`
- [ ] Step 3: Register in `APIRouter` in `api.ts`
- [ ] Step 4: Find and migrate all callers
  - [ ] Check `shared/src/models/`
  - [ ] Check `desktop/src/models/`
  - [ ] Check `web/app/routes/`
- [ ] Step 5: Remove from `UniversalClient` interface
- [ ] Step 6: Remove from desktop universal client
- [ ] Step 7: Remove from web universal client
- [ ] Step 8: Build types successfully
- [ ] Step 9: Run tests successfully
- [ ] Step 10: Manual testing on both platforms

## Example: Complete fetchResource Migration

See commit history for the complete `fetchResource` → `Resource` API migration as a reference example.

**Files changed:**
- `frontend/packages/shared/src/hm-types.ts` - Already had types defined
- `frontend/packages/shared/src/api-resource.ts` - New handler
- `frontend/packages/shared/src/api.ts` - Registered handler
- `frontend/packages/shared/src/models/entity.ts` - Migrated 4 callers
- `frontend/packages/shared/src/universal-client.ts` - Removed interface method
- `frontend/packages/shared/src/create-web-universal-client.tsx` - Removed implementation
- `frontend/apps/desktop/src/desktop-universal-client.tsx` - Removed implementation

## Remaining UniversalClient Methods

These methods are still on `UniversalClient` and need migration:

- [ ] `fetchRecents()` → `Recents` API
- [ ] `deleteRecent(id: string)` → `DeleteRecent` API

Also remaining: `CommentEditor` component (platform-specific, may stay on UniversalClient)

## Benefits of This Pattern

1. **Unified Implementation**: Same code runs on desktop and web (through gRPC)
2. **Type Safety**: Full TypeScript support with discriminated unions
3. **Validation**: Client and server both validate with Zod schemas
4. **Maintainability**: One place to update logic instead of 2+ platform-specific implementations
5. **Testability**: Easier to test since implementation is platform-agnostic

## Notes

- The `request()` method is already implemented on both platforms, so you only need to add handlers to `APIRouter`
- Desktop uses `desktopRequest()` which calls `APIRouter[key].getData()` directly
- Web uses HTTP endpoint `/api/{key}` which also calls `APIRouter[key].getData()` on the server
- Both platforms validate responses using the same Zod schemas
- Keep existing helper functions (like `createResourceFetcher`) and reuse them in new handlers

---

# React Hooks Migration (use* methods)

For React hooks on `UniversalClient` (like `useResource`, `useAccountsMetadata`), the migration pattern differs from `fetch*` methods. Hooks should be moved to the shared models layer and return `UseQueryResult` for proper React Query integration.

## Overview

**Goal**: Migrate platform-specific hook implementations from `UniversalClient` to shared hooks in `frontend/packages/shared/src/models/` that use `client.request()` internally.

**Pattern**:
- **Before**: `client.useAccountsMetadata(uids)` returns `HMAccountsMetadata` (raw data)
- **After**: `useAccountsMetadata(uids)` from `@shm/shared/models/entity` returns `UseQueryResult<HMAccountsMetadata>`

## Key Differences from fetch* Migration

| Aspect | fetch* Migration | use* Hook Migration |
|--------|------------------|---------------------|
| Return type | `Promise<T>` | `UseQueryResult<T>` |
| Implementation location | `api-{name}.ts` + `APIRouter` | `models/{name}.ts` |
| Caller updates | Change method name | Handle `UseQueryResult` (`.data`, `.isLoading`, etc.) |
| UniversalClient | Remove entirely | Remove entirely |

## Step-by-Step Hook Migration

### Step 1: Identify or Create Shared Hook

Check if the hook already exists in `frontend/packages/shared/src/models/`:

```bash
grep -r "export function useYourHook" frontend/packages/shared/src/models/
```

If it exists, you may only need to update callers. If not, create it.

### Step 2: Implement Shared Hook

In `frontend/packages/shared/src/models/entity.ts` (or appropriate model file):

```typescript
import {useQueries, UseQueryResult} from '@tanstack/react-query'
import {useUniversalClient} from '../routing'
import {queryKeys} from './query-keys'

export function useAccountsMetadata(
  uids: string[],
): UseQueryResult<HMMetadataPayload | null>[] {
  const client = useUniversalClient()
  return useQueries({
    queries: uids.map((uid) => ({
      enabled: !!uid,
      queryKey: [queryKeys.ACCOUNT, uid],
      queryFn: async (): Promise<HMMetadataPayload | null> => {
        if (!uid) return null
        return await client.request<HMAccountRequest>('Account', uid)
      },
    })),
  })
}
```

**Key points:**
- Use `useUniversalClient()` to get the client with `request()` method
- Return `UseQueryResult` or `UseQueryResult[]` for proper React Query integration
- Use existing query keys from `queryKeys` for cache consistency

### Step 3: Update Callers to Handle UseQueryResult

Find all usages:

```bash
grep -r "client\.useAccountsMetadata" frontend/
```

Update each caller to handle `UseQueryResult`:

**Before:**
```typescript
const accountsMetadata = client.useAccountsMetadata(authorIds)
// Direct usage: accountsMetadata[uid].metadata
```

**After:**
```typescript
import {useAccountsMetadata} from '@shm/shared/models/entity'

const accountsResults = useAccountsMetadata(authorIds)

// Derive data from results
const accountsMetadata = useMemo(() => {
  return Object.fromEntries(
    accountsResults
      .map((result, i) => {
        if (!result.data) return null
        return [authorIds[i], result.data]
      })
      .filter((entry): entry is [string, HMMetadataPayload] => !!entry),
  )
}, [accountsResults, authorIds])

// Can also check loading/error states
const isLoading = accountsResults.some((r) => r.isLoading)
```

### Step 4: Remove from UniversalClient Interface

In `frontend/packages/shared/src/universal-client.ts`:

```typescript
export type UniversalClient = {
  // Remove this:
  // useAccountsMetadata(uids: string[]): HMAccountsMetadata

  // Keep request method
  request<Request extends HMRequest>(
    key: Request['key'],
    input: Request['input'],
  ): Promise<Request['output']>
}
```

### Step 5: Remove Platform Implementations

**Desktop** - `frontend/apps/desktop/src/desktop-universal-client.tsx`:
```typescript
// Remove import and usage
// import {useAccountsMetadata} from '@/models/entities'

export const desktopUniversalClient: UniversalClient = {
  // Remove:
  // useAccountsMetadata: useAccountsMetadata,
}
```

**Web** - `frontend/packages/shared/src/create-web-universal-client.tsx`:
```typescript
// Remove implementation
export function createWebUniversalClient(deps: WebClientDependencies): UniversalClient {
  return {
    // Remove entire useAccountsMetadata block
  }
}
```

## Hook Migration Checklist

For each hook you migrate:

- [ ] Step 1: Check if shared hook exists in `models/`
- [ ] Step 2: Create/update shared hook using `client.request()`
- [ ] Step 3: Find and update all callers
  - [ ] Import hook from `@shm/shared/models/entity`
  - [ ] Handle `UseQueryResult` instead of raw data
  - [ ] Derive data using `useMemo` if needed
  - [ ] Consider loading/error states if applicable
- [ ] Step 4: Remove from `UniversalClient` interface
- [ ] Step 5: Remove from desktop universal client
- [ ] Step 6: Remove from web universal client
- [ ] Step 7: Build types successfully
- [ ] Step 8: Run tests successfully

## Example: useAccountsMetadata Migration

### Before (in blocks-content.tsx)
```typescript
const client = useUniversalClient()
const accountsMetadata = client.useAccountsMetadata(authorIds)

// Pass directly to component
<QueryBlockContent accountsMetadata={accountsMetadata} />
```

### After (in blocks-content.tsx)
```typescript
import {useAccounts} from '@shm/shared/models/entity'

const accountsResults = useAccounts(authorIds)

// Derive HMAccountsMetadata from UseQueryResult[]
const accountsMetadata = useMemo(() => {
  return Object.fromEntries(
    accountsResults
      .map((result, i) => {
        if (!result.data) return null
        return [authorIds[i], result.data]
      })
      .filter((entry): entry is [string, HMMetadataPayload] => !!entry),
  )
}, [accountsResults, authorIds])

<QueryBlockContent accountsMetadata={accountsMetadata} />
```

## Benefits

1. **Unified Caching**: All platforms use same React Query cache keys
2. **Loading States**: Callers get `isLoading`, `isError`, `refetch` etc.
3. **Suspense Support**: Can use with React Suspense if needed
4. **Optimistic Updates**: Easier cache manipulation
5. **DevTools**: React Query DevTools work consistently

---

# Service Provider Migration (ActivityService, CommentsService)

Service providers like `ActivityService` and `CommentsService` use a different pattern than `UniversalClient` methods. They're class-based services passed via React Context that need migration to the unified API router pattern.

## Current Architecture

### Service Pattern Flow
1. **Interface**: `ActivityService`/`CommentsService` interfaces in `shared/src/models/`
2. **Implementations**: Platform-specific classes (`DesktopActivityService`, `WebActivityService`, etc.)
3. **Context**: Service providers (`ActivityProvider`, `CommentsProvider`) wrap app with service instance
4. **Hooks**: Shared hooks (`useActivityFeed`, `useDiscussionsService`) consume service from context

### Key Files

**Activity Service:**
- `frontend/packages/shared/src/models/activity-service.ts` - Interface & shared impl functions
- `frontend/packages/shared/src/activity-service-provider.tsx` - Context & hooks
- `frontend/apps/desktop/src/desktop-activity-service.ts` - Desktop implementation
- `frontend/apps/web/app/web-activity-service.ts` - Web implementation

**Comments Service:**
- `frontend/packages/shared/src/models/comments-service.ts` - Interface & shared impl functions
- `frontend/packages/shared/src/comments-service-provider.tsx` - Context & hooks
- `frontend/apps/desktop/src/desktop-comments-service.ts` - Desktop implementation
- `frontend/apps/web/app/web-comments-service.ts` - Web implementation

## Migration Goal

Migrate from:
```typescript
// Service class + Context pattern
const context = useActivityServiceContext()
const response = await context.service.listEvents(params)
```

To:
```typescript
// Unified request pattern
const client = useUniversalClient()
const response = await client.request<HMListEventsRequest>('ListEvents', params)
```

## Step-by-Step Service Migration

### Step 1: Define Request/Response Types in hm-types.ts

For each service method, create a request schema:

```typescript
// Activity Service methods
export const HMListEventsRequestSchema = z.object({
  key: z.literal('ListEvents'),
  input: z.object({
    pageSize: z.number().optional(),
    pageToken: z.string().optional(),
    trustedOnly: z.boolean().optional(),
    filterAuthors: z.array(z.string()).optional(),
    filterEventType: z.array(z.string()).optional(),
    filterResource: z.string().optional(),
  }),
  output: z.object({
    events: z.array(HMEventSchema),
    nextPageToken: z.string(),
  }),
})
export type HMListEventsRequest = z.infer<typeof HMListEventsRequestSchema>

export const HMResolveEventRequestSchema = z.object({
  key: z.literal('ResolveEvent'),
  input: z.object({
    event: HMEventSchema,
    currentAccount: z.string().optional(),
  }),
  output: LoadedEventSchema.nullable(),
})
export type HMResolveEventRequest = z.infer<typeof HMResolveEventRequestSchema>
```

Add to discriminated union:
```typescript
export const HMRequestSchema = z.discriminatedUnion('key', [
  // ... existing
  HMListEventsRequestSchema,
  HMResolveEventRequestSchema,
])
```

### Step 2: Create API Handler

Create `frontend/packages/shared/src/api-activity.ts`:

```typescript
import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {
  HMListEventsRequest,
  HMResolveEventRequest,
} from './hm-types'
import {
  listEventsImpl,
  loadCommentEvent,
  loadRefEvent,
  // ... other loaders
  getEventType,
} from './models/activity-service'

export const ListEvents: HMRequestImplementation<HMListEventsRequest> = {
  async getData(grpcClient: GRPCClient, input) {
    return listEventsImpl(grpcClient, input)
  },
}

export const ResolveEvent: HMRequestImplementation<HMResolveEventRequest> = {
  async getData(grpcClient: GRPCClient, input) {
    const {event, currentAccount} = input
    const eventType = getEventType(event)

    switch (eventType) {
      case 'comment':
        return loadCommentEvent(grpcClient, event, currentAccount)
      case 'ref':
        return loadRefEvent(grpcClient, event, currentAccount)
      // ... etc
      default:
        return null
    }
  },
}
```

### Step 3: Register in API Router

In `frontend/packages/shared/src/api.ts`:

```typescript
import {ListEvents, ResolveEvent} from './api-activity'

export const APIRouter: APIRouterType = {
  // ... existing
  ListEvents,
  ResolveEvent,
}
```

### Step 4: Migrate Hooks to Use client.request()

Update `activity-service-provider.tsx`:

**Before:**
```typescript
export function useActivityFeed({...}) {
  const context = useActivityServiceContext()

  return useInfiniteQuery({
    queryFn: async ({pageParam}) => {
      const response = await context.service.listEvents({...})
      const resolvedEvents = await Promise.allSettled(
        response.events.map((event) =>
          context.service!.resolveEvent(event, currentAccount)
        )
      )
      // ...
    },
    enabled: !!context.service,
  })
}
```

**After:**
```typescript
import {useUniversalClient} from './routing'

export function useActivityFeed({...}) {
  const client = useUniversalClient()

  return useInfiniteQuery({
    queryFn: async ({pageParam}) => {
      const response = await client.request<HMListEventsRequest>('ListEvents', {...})
      const resolvedEvents = await Promise.allSettled(
        response.events.map((event) =>
          client.request<HMResolveEventRequest>('ResolveEvent', {event, currentAccount})
        )
      )
      // ...
    },
    // No longer needs enabled check - client.request always available
  })
}
```

### Step 5: Remove Service Interface & Implementations

After all methods are migrated:

1. **Remove service interface** from `models/activity-service.ts`
2. **Remove platform implementations**:
   - `desktop-activity-service.ts`
   - `web-activity-service.ts`
3. **Remove context provider** (`ActivityProvider`) or simplify to only hold non-API state (like `onReplyClick` callbacks)
4. **Keep shared implementation functions** (`listEventsImpl`, `loadCommentEvent`, etc.) - these are reused by API handlers

### Step 6: Simplify Context (if needed)

If the context only held the service, remove it entirely. If it has other state (like callbacks), simplify:

**Before:**
```typescript
type CommentsProviderValue = {
  onReplyClick: (comment: HMComment) => void
  onReplyCountClick: (comment: HMComment) => void
  service: CommentsService | null
}
```

**After:**
```typescript
type CommentsProviderValue = {
  onReplyClick: (comment: HMComment) => void
  onReplyCountClick: (comment: HMComment) => void
  // service removed - now using client.request()
}
```

## Service Migration Checklist

### ActivityService

Methods to migrate:
- [ ] `listEvents` → `ListEvents` API
- [ ] `resolveEvent` → `ResolveEvent` API

### CommentsService ✅ COMPLETED

Methods migrated:
- [x] `listComments` → `ListComments` API
- [x] `listDiscussions` → `ListDiscussions` API
- [x] `listCommentsByReference` → `ListCommentsByReference` API
- [x] `deleteComment` → `DeleteComment` API
- [x] `getReplyCount` → `GetCommentReplyCount` API

Special cases:
- [x] `useHackyAuthorsSubscriptions` - Passed via context as callback, desktop provides implementation

Note: `listCommentsById` was not migrated as it's not currently used

## Handling Special Cases

### Platform-Specific Methods

Some methods like `useHackyAuthorsSubscriptions` are desktop-only and may not fit the API pattern:

```typescript
// Option 1: Keep as platform-specific hook in desktop only
// frontend/apps/desktop/src/hooks/use-authors-subscriptions.ts
export function useHackyAuthorsSubscriptions(authorIds: string[]) {
  useSubscribedResources(...)
}

// Option 2: Make it a no-op in shared and override on desktop
export function useHackyAuthorsSubscriptions(authorIds: string[]) {
  // Default no-op, desktop provides real implementation via context
}
```

### Mutations (deleteComment, etc.)

For mutations, continue using React Query's `useMutation`:

```typescript
export function useDeleteComment() {
  const client = useUniversalClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: DeleteCommentRequest) => {
      await client.request<HMDeleteCommentRequest>('DeleteComment', params)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: [queryKeys.DOCUMENT_DISCUSSION]})
    },
  })
}
```

## Benefits of Service Migration

1. **No more service context boilerplate**: Remove provider wrappers and context consumers
2. **Unified data layer**: All data fetching through single `client.request()` pattern
3. **Simpler initialization**: No need to create/pass service instances
4. **Better tree-shaking**: Only import what you use
5. **Consistent error handling**: API router handles errors uniformly
6. **Type safety**: Full TypeScript inference from request schemas
