# @shm/shared - Quick Reference

## File Locations
- Package root: `frontend/packages/shared`
- Source: `src/` (36 top-level files + subdirectories)
- Built types: `dist/` (auto-generated .d.ts files)
- Tests: `src/**/*.test.ts` or `src/**/__tests__/` directories

## Directory Tree
```
src/
├── client/                    # gRPC client (proto-generated + custom)
│   ├── .generated/           # Auto-generated from .proto
│   ├── client-utils.ts
│   ├── grpc-types.ts
│   ├── editorblock-to-hmblock.ts
│   ├── hmblock-to-editorblock.ts
│   └── index.ts
├── models/                    # Data models & React hooks
│   ├── entity.ts             # Core: useAccount, useResource
│   ├── query-keys.ts         # React Query key definitions
│   ├── activity-service.ts
│   ├── comments-service.ts
│   ├── comments-resolvers.ts
│   ├── payments.ts
│   └── ... (others)
├── utils/                     # Utility functions
│   ├── entity-id-url.ts      # Core: hmId, unpackHmId, packHmId
│   ├── document-path.ts
│   ├── breadcrumbs.ts
│   ├── date.ts
│   └── __tests__/
├── __tests__/                # Top-level tests
├── hm-types.ts              # Core: Types + Zod schemas
├── universal-client.ts      # Platform-agnostic interface
├── create-web-universal-client.tsx
├── grpc-client.ts           # GRPCClient factory
├── index.ts                 # Main barrel export
└── ... (36 files total)
```

## Key Files Reference

| File | Purpose |
|------|---------|
| `index.ts` | Barrel export - all public API |
| `hm-types.ts` | Core Hypermedia types + Zod schemas |
| `universal-client.ts` | Platform-agnostic client interface |
| `grpc-client.ts` | gRPC client factory |
| `models/entity.ts` | useAccount, useResource hooks |
| `models/query-keys.ts` | React Query keys (centralized) |
| `utils/entity-id-url.ts` | hmId utilities |

## Build & Scripts

```bash
# Build types to dist/
yarn workspace @shm/shared build:types

# Type check
yarn workspace @shm/shared typecheck

# Test
yarn workspace @shm/shared test
yarn workspace @shm/shared test:w      # watch

# Format
yarn workspace @shm/shared format:check
yarn workspace @shm/shared format:write
```

## TypeScript Config

| File | Purpose |
|------|---------|
| `tsconfig.json` | References (app.json, node.json) |
| `tsconfig.app.json` | Dev config: ES2022, React JSX, bundler mode |
| `tsconfig.types.json` | Build config: declaration only, to dist/ |

## How to Import

```typescript
// From main barrel (most common)
import { hmId, useAccount, queryKeys } from '@shm/shared'

// From sub-modules (for code splitting)
import { useAccount, useResource } from '@shm/shared/models/entity'
import { unpackHmId, packHmId } from '@shm/shared/utils/entity-id-url'
import { HMMetadataPayload } from '@shm/shared/hm-types'
```

## Dependencies
- `@bufbuild/protobuf` - Protocol Buffers
- `@connectrpc/connect-web` - gRPC-web client
- `@tanstack/react-query` - Data fetching/caching
- `zod` - Runtime type validation
- `xstate` - State machines
- `react` - UI library

## Testing Pattern
```typescript
// Use vitest
import { describe, expect, test } from 'vitest'

describe('my function', () => {
  test('does X', () => {
    expect(result).toEqual(expected)
  })
})
```

## Export Pattern (Barrel)
```typescript
// src/graphql/index.ts
export * from './client'
export * from './queries'
export * from './mutations'

// Then add to src/index.ts
export * from './graphql'
```

## Workspace Integration
```json
// package.json in dependent packages
{
  "dependencies": {
    "@shm/shared": "workspace:*"
  }
}
```

## Zod Type Pattern
```typescript
// Define schema AND export inferred type
export const MySchema = z.object({
  id: z.string(),
  value: z.number(),
})
export type MyType = z.infer<typeof MySchema>
```

## Type Path Aliases
```json
"paths": {
  "@shm/ui/*": ["../ui/src/*"],
  "@shm/shared/*": ["../shared/src/*"]
}
```

## Common Patterns

### React Query Integration
```typescript
import { queryKeys } from '@shm/shared'
import { useQuery } from '@tanstack/react-query'

const { data } = useQuery({
  queryKey: [queryKeys.ACCOUNT, accountId],
  queryFn: () => client.documents.getAccount({ accountId }),
})
```

### Service Provider Pattern
```typescript
import { ActivityProvider } from '@shm/shared/activity-service-provider'

// In app
<ActivityProvider>
  <App />
</ActivityProvider>
```

### Universal Client (Platform-agnostic)
```typescript
import { UniversalClient } from '@shm/shared'

// Web implementation
const client = createWebUniversalClient(deps)
// Desktop: similar pattern in desktop app
```

## Quick Checklist for New Modules

- [ ] Create `src/mymodule/index.ts` (barrel)
- [ ] Add exports to `src/index.ts`
- [ ] Use `models/` for hooks, `utils/` for helpers
- [ ] Add `*.test.ts` alongside code
- [ ] Run `yarn workspace @shm/shared build:types`
- [ ] Run `yarn workspace @shm/shared test`
- [ ] Verify imports work from `@shm/shared`
