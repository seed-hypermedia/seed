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

## Remaining APIs to Migrate

These methods are still on `UniversalClient` and need migration:

- [ ] `fetchAccount(accountUid: string)`
- [ ] `fetchBatchAccounts(accountUids: string[])`
- [ ] `fetchQuery(query: HMQuery)`
- [ ] `fetchSearch(query: string, opts?: {...})`
- [ ] `fetchRecents()`
- [ ] `deleteRecent(id: string)`

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

## Hooks Remaining to Migrate

These hooks are still on `UniversalClient`:

- [ ] `useResource` - Already has shared implementation, remove from UniversalClient
- [ ] `useResources` - Already has shared implementation, remove from UniversalClient
- [x] `useDirectory` - Migrated to shared `useDirectory` in `models/entity.ts`, uses `HMQueryRequest`
- [ ] `useContacts` - Desktop-only, may stay platform-specific
- [ ] `useAccountsMetadata` - Migrate to use `useAccounts` from shared

## Benefits

1. **Unified Caching**: All platforms use same React Query cache keys
2. **Loading States**: Callers get `isLoading`, `isError`, `refetch` etc.
3. **Suspense Support**: Can use with React Suspense if needed
4. **Optimistic Updates**: Easier cache manipulation
5. **DevTools**: React Query DevTools work consistently
