# tRPC Architecture Analysis: Dual Client Problem

## Current Architecture

The desktop app currently uses **two separate tRPC clients**:

### 1. Vanilla Client (`client` in `trpc.ts`)
```typescript
export const client = createTRPCProxyClient<AppRouter>({
  links: [ipcLink()],
  transformer: superjson,
})
```
- Used in: `desktop-universal-client.tsx`, `ipc.ts`, `models/recents.ts`, `models/contacts.ts`, etc.
- Called via: `client.drafts.listAccount.query(accountUid)`
- **No React Query integration** - results are not cached in React Query

### 2. React Query Client (`trpc` in `trpc.ts`)
```typescript
export const trpc = createTRPCReact<AppRouter>()
```
- Provider created in `root.tsx` with **another** `ipcLink()` call
- Used in: `pages/drafts.tsx`, `pages/draft.tsx`, `models/accounts.ts`, etc.
- Called via: `trpc.drafts.list.useQuery()` or `utils.drafts.listAccount.invalidate()`
- **Integrates with React Query** - results cached and managed

## The Problem

These two clients each create their own `ipcLink()` connection. This causes:

1. **Separate IPC channels**: Each client maintains independent communication with the main process
2. **Cache desync**: The vanilla client bypasses React Query entirely, so:
   - Invalidating via `utils.drafts.listAccount.invalidate()` doesn't affect vanilla client results
   - Manual queries via `client.drafts.listAccount.query()` aren't cached in React Query
3. **Potential IPC routing bugs**: With two IPC links handling requests, there may be race conditions or message routing issues causing responses to go to the wrong client

### Evidence of the Bug

The `useAccountDrafts` hook uses the vanilla client:
```typescript
// in desktop-universal-client.tsx
drafts: {
  listAccountDrafts: (accountUid) =>
    trpcClient.drafts.listAccount.query(accountUid),  // Uses vanilla client
},
```

But invalidation happens via React Query utils:
```typescript
// in root.tsx
} else if (queryKey[0] == 'trpc.drafts.listAccount') {
  utils.drafts.listAccount.invalidate()  // Invalidates React Query client
  queryClient.invalidateQueries({queryKey: [queryKeys.ACCOUNT_DRAFTS]})  // Also invalidates our custom query
}
```

The bug where `drafts.listAccount` returns `{favorites: Array(0)}` suggests the IPC layer is somehow routing the request to the wrong procedure or returning a cached response from a different query.

## Research Findings

### From tRPC Community Discussions

> "The cache with react-query will not be in sync with this other instance. Ideally they're bound together so the cache is not out of sync."
> - [tRPC Discussion #1351](https://github.com/trpc/trpc/discussions/1351)

### electron-trpc Issues

- [electron-trpc v0.6.1](https://github.com/jsonnull/electron-trpc/releases) fixed subscription cleanup issues
- Multiple open bugs in the repo suggest IPC handling isn't bulletproof
- A [fork exists for tRPC v11](https://github.com/mat-sz/trpc-electron/) suggesting maintenance concerns

## Proposed Solutions

### Option A: Unify on React Query + Manual Queries (Recommended)

Remove the vanilla `createTRPCProxyClient` and use **only** `createTRPCReact`. For non-hook contexts, use the query client directly:

```typescript
// Access the tRPC client through context for non-hook usage
const trpcClient = trpc.useContext().client

// Or for truly outside-React contexts, export the client from the provider
```

**Pros:**
- Single IPC link
- All queries go through React Query cache
- Proper invalidation everywhere

**Cons:**
- Requires refactoring files that import `client` from `@/trpc`
- Some contexts (like `universal-client`) need access to client outside hooks

### Option B: Remove React Query tRPC Integration

Remove `createTRPCReact` entirely and only use the vanilla client with manual React Query integration:

```typescript
// trpc.ts - single client
export const trpcClient = createTRPCProxyClient<AppRouter>({
  links: [ipcLink()],
  transformer: superjson,
})

// Wrap in useQuery manually everywhere
const drafts = useQuery({
  queryKey: ['drafts.listAccount', accountUid],
  queryFn: () => trpcClient.drafts.listAccount.query(accountUid),
})
```

**Pros:**
- Full control over caching
- Single IPC link
- Already mostly doing this in `entity.ts` via universal client
- Consistent with how `universal-client` pattern works

**Cons:**
- More boilerplate
- Lose tRPC's automatic query key generation
- Need to manually handle all invalidation

### Option C: Keep Both But Share IPC Link (Quick Fix)

Create a single shared IPC link instance:

```typescript
// trpc.ts
const sharedIpcLink = ipcLink()

export const client = createTRPCProxyClient<AppRouter>({
  links: [sharedIpcLink],
  transformer: superjson,
})

export const trpc = createTRPCReact<AppRouter>()

// root.tsx - use same link
const trpcClient = useMemo(
  () => trpc.createClient({
    links: [sharedIpcLink],  // Same link
    transformer: superjson,
  }),
  [],
)
```

**Pros:**
- Minimal changes
- Single IPC channel

**Cons:**
- Still have cache desync between vanilla and React Query clients
- May not fix the underlying bug

## Recommendation

**Option B (Remove React Query tRPC Integration)** aligns best with your current architecture:

1. You're already building a `UniversalClient` abstraction that wraps queries in `useQuery`
2. The desktop-specific code can use vanilla tRPC + manual `useQuery`
3. Web can use whatever HTTP client it needs
4. Consistent pattern everywhere

### Migration Path

1. Audit all usages of `trpc.*.useQuery()` and convert to `useQuery` + vanilla client
2. Remove `createTRPCReact` and `trpc.Provider`
3. Update invalidation logic to use standard React Query `queryClient.invalidateQueries()`
4. Keep query keys consistent with existing `queryKeys` constants

### Files to Migrate

Current usage of `trpc.*.useQuery()`:
- `models/favorites.ts`
- `models/settings.ts`
- `models/accounts.ts`
- `models/host.ts`
- `models/comments.ts`
- `models/daemon.ts`
- `models/app-settings.ts`
- `models/gateway-settings.ts`
- `models/documents.ts`
- `utils/navigation-container.tsx`
- `components/location-picker.tsx`
- `components/search-input.tsx`
- `components/import-doc-button.tsx`
- `pages/drafts.tsx`

---

## Immediate Fix for Current Bug

As a quick fix while deciding on architecture, try using the React Query client from context instead of the vanilla client in `desktop-universal-client.tsx`:

```typescript
// This won't work directly because it's not a hook context
// but the idea is to ensure we're using the same client
```

Actually, since `desktop-universal-client.tsx` creates a static object (not a hook), it can't access the React Query tRPC client. This is why Option B makes the most sense - embrace vanilla client + manual useQuery everywhere.
