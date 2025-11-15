# @shm/shared Package Structure & Architecture Guide

## Overview
The `@shm/shared` package is a core monorepo package in the Seed project that exports shared utilities, models, types, and client code used across web, desktop, and other frontend applications.

**Location:** `/Users/ericvicenti/Code/Seed/frontend/packages/shared`

---

## 1. PACKAGE ORGANIZATION & KEY FILES

### 1.1 Root Package Configuration

**`package.json`**
- **Name:** `@shm/shared`
- **Entry Points:**
  - `main`: `src/index.ts` (source entry during dev)
  - `types`: `dist/index.d.ts` (compiled types)
- **Version:** `0.1.0`

**Key Scripts:**
```bash
yarn workspace @shm/shared build:types     # Build type declarations to dist/
yarn workspace @shm/shared typecheck       # Type check with tsconfig.app.json
yarn workspace @shm/shared test            # Run all tests
yarn workspace @shm/shared test:w          # Watch mode
```

### 1.2 TypeScript Configuration

**`tsconfig.json`** - Project references root
- References `tsconfig.app.json` and `tsconfig.node.json`

**`tsconfig.app.json`** - Main configuration for development
```
- Target: ES2022
- Module: ESNext
- moduleResolution: bundler
- jsx: react-jsx
- Strict mode enabled with extra checks
- Path aliases:
  @shm/ui/*: ../ui/src/*
```

**`tsconfig.types.json`** - Generation configuration for dist/
```
- Extends tsconfig.app.json
- declaration: true (emit .d.ts files)
- emitDeclarationOnly: true (only types, no .js)
- outDir: ./dist
- Excludes: **/*.test.ts, **/*.test.tsx
```

### 1.3 Directory Structure

```
src/
  index.ts                          # Main export barrel
  client/                           # gRPC client code (generated + custom)
    .generated/                     # Generated from .proto files
    client-utils.ts
    grpc-types.ts
    editorblock-to-hmblock.ts
    hmblock-to-editorblock.ts
  models/                           # Data models & hooks
    entity.ts                       # useAccount, useResource, etc.
    query-keys.ts                   # React Query key definitions
    activity-service.ts
    comments-service.ts
    comments-resolvers.ts
    payment-allocations.ts
    payments.ts
    search.ts
    recents.ts
  utils/                            # Utility functions
    entity-id-url.ts               # hmId, unpackHmId, packHmId, etc.
    document-path.ts
    breadcrumbs.ts
    date.ts
    format-bytes.ts
    language.ts
    use-debounce.ts
    use-isomorphic-layout-effect.ts
    stream.ts
    clone.ts
    path-api.ts
    shorten-path.ts
    __tests__/
      entity-id-url.test.ts
  __tests__/                        # Top-level tests
    document-to-text.test.ts
    html-to-blocks.test.ts
    document-utils.test.ts
  hm-types.ts                       # Core types (zod-validated)
  universal-client.ts               # Platform-agnostic client interface
  create-web-universal-client.tsx   # Web implementation
  grpc-client.ts                    # gRPC client factory
  comments.ts
  content.ts
  constants.ts
  document-content-types.ts
  document-to-text.ts
  document-utils.ts
  editor-types.ts
  feed-loader.ts
  feed-types.ts
  gateway-url.ts
  html-to-blocks.ts
  interaction-summary.ts
  outline.ts
  range-selection.tsx
  resolve-hm.ts
  resource-loader.ts
  routes.ts
  routing.tsx
  site-hostname.ts
  translation.ts
  try-until-success.ts
  url.ts
  use-hover.ts
  use-stream.ts
  use-lowlight.ts
  activity-service-provider.tsx
  comments-service-provider.tsx
  account-utils.ts
  citation-deduplication.ts
  language-packs/
  styles/

dist/                               # Built type declarations
  *.d.ts                           # Generated type files
  client/
    .generated/
    ...
  models/
  utils/
```

---

## 2. MODULE EXPORT PATTERNS

### 2.1 Main Index Export (`index.ts`)
Uses barrel pattern with wildcard exports:
```typescript
export * from './citation-deduplication'
export * from './client'
export * from './interaction-summary'
export * from './comments'
export * from './content'
export * from './create-web-universal-client'
export * from './document-to-text'
export * from './editor-types'
export * from './grpc-client'
export * from './hm-types'
export * from './models/activity-service'
export * from './models/comments-resolvers'
export * from './models/email-notifications'
export * from './models/payment-allocations'
export * from './models/payments'
export * from './models/query-client'
export * from './models/query-keys'
export * from './models/recents'
export * from './models/search'
export * from './outline'
export * from './range-selection'
export * from './routes'
export * from './routing'
export * from './site-hostname'
export * from './try-until-success'
export * from './universal-client'
export * from './use-hover'
export * from './use-lowlight'
export * from './utils'
```

### 2.2 Sub-Module Exports
Apps can import from:
```typescript
// Main exports from index
import { hmId, useAccount } from '@shm/shared'

// Direct sub-module imports (bypassing barrel)
import { useAccount, useResource } from '@shm/shared/models/entity'
import { unpackHmId, packHmId } from '@shm/shared/utils/entity-id-url'
import { HMMetadataPayload } from '@shm/shared/hm-types'
```

### 2.3 Client/gRPC Exports
```typescript
// From client/index.ts
export * from './client-utils'
export * from './editorblock-to-hmblock'
export * from './grpc-types'
export * from './hmblock-to-editorblock'
```

---

## 3. KEY ARCHITECTURAL PATTERNS

### 3.1 Universal Client Pattern
**Purpose:** Platform-agnostic interface that works on both desktop and web

**File:** `universal-client.ts`
```typescript
export type UniversalClient = {
  useResource()           // Load single resource
  useResources()          // Batch load resources
  useDirectory()          // List directory contents
  useContacts()           // Get contacts
  useAccountsMetadata()   // Batch load account metadata
  CommentEditor           // React component
  loadSearch()            // Search function
  loadResource()          // Load resource data
  loadAccount()           // Load account data
  loadBatchAccounts()     // Batch load accounts
  loadRecents()           // Load recents list
  deleteRecent()          // Delete recent item
}
```

**Implementations:**
- Web: `create-web-universal-client.tsx` - uses REST APIs
- Desktop: Similar pattern in desktop app

### 3.2 React Query Integration
**Location:** `models/query-keys.ts`
- Centralized query key definitions
- Used with @tanstack/react-query
- Keys organized by feature (feed, accounts, documents, entities, etc.)

**Usage Example:**
```typescript
const { data: account } = useQuery({
  queryKey: [queryKeys.ACCOUNT, accountId],
  queryFn: () => client.documents.getAccount({ accountId }),
})
```

### 3.3 gRPC Client Factory
**File:** `grpc-client.ts`
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

### 3.4 Type System with Zod Validation
**File:** `hm-types.ts`
- Uses Zod for runtime validation
- All major types include schemas
- Enables safe runtime type checking

**Example:**
```typescript
export const unpackedHmIdSchema = z.object({
  id: z.string(),
  uid: z.string(),
  path: z.array(z.string()).nullable(),
  version: z.string().nullable(),
  blockRef: z.string().nullable(),
  // ...
})
export type UnpackedHypermediaId = z.infer<typeof unpackedHmIdSchema>
```

### 3.5 Service Provider Pattern
React context providers for managing app state:
- `activity-service-provider.tsx` - Activity/timeline data
- `comments-service-provider.tsx` - Comments management

---

## 4. DEPENDENCIES

### Production Dependencies
```json
{
  "@bufbuild/protobuf": "1.10.0",          // Protocol Buffers
  "@connectrpc/connect-web": "1.1.3",      // gRPC-web client
  "@tanstack/react-query": "^4.36.1",      // Data fetching/caching
  "@xstate/react": "4.1.3",                // State machine React hooks
  "cheerio": "^1.0.0",                     // HTML parsing
  "katex": "0.16.9",                       // Math rendering
  "lowlight": "3.1.0",                     // Syntax highlighting
  "nanoid": "4.0.2",                       // ID generation
  "react": "18.2.0",                       // UI library
  "react-tweet": "3.2.0",                  // Tweet embeds
  "xstate": "5.19.2",                      // State machines
  "zod": "^3.x"                            // Runtime type validation (inferred)
}
```

### Development Dependencies
```json
{
  "typescript": "5.8.3",
  "vitest": "0.34.2"                       // Test runner
}
```

---

## 5. BUILD & TYPE GENERATION

### 5.1 Build Process
```bash
# Build type declarations to dist/
yarn workspace @shm/shared build:types

# Generates:
# - dist/*.d.ts files for all src/*.ts files
# - dist/models/*.d.ts files
# - dist/utils/*.d.ts files
# - dist/client/*.d.ts files (generated + custom)
```

### 5.2 Type Checking
```bash
# Check types in tsconfig.app.json (development)
yarn workspace @shm/shared typecheck

# Full workspace typecheck (requires build:types first)
yarn typecheck
```

### 5.3 Output Structure
```
dist/
  index.d.ts                    # Main barrel
  *.d.ts                        # Top-level module types
  models/
    query-keys.d.ts
    entity.d.ts
    activity-service.d.ts
    comments-service.d.ts
    ...
  utils/
    entity-id-url.d.ts
    date.d.ts
    ...
  client/
    .generated/                 # Generated from .proto
    grpc-types.d.ts
    editorblock-to-hmblock.d.ts
    ...
```

---

## 6. TESTING SETUP

### 6.1 Test Configuration
- Test runner: Vitest
- Test patterns: `**/*.test.ts` and `**/*.test.tsx`

### 6.2 Existing Tests
```
src/__tests__/
  document-to-text.test.ts
  html-to-blocks.test.ts
  document-utils.test.ts

src/utils/__tests__/
  entity-id-url.test.ts          # Tests for hmId utilities

src/utils/
  document-path.test.ts          # Vitest co-located test

src/models/__tests__/
  payment-allocations.test.ts

src/client/__tests__/
  editorblock-to-hmblock.test.ts
  hmblock-to-editorblock.test.ts
  image-paste-functionality.test.ts
```

### 6.3 Running Tests
```bash
yarn workspace @shm/shared test      # Run once
yarn workspace @shm/shared test:w    # Watch mode
```

---

## 7. USAGE IN OTHER PACKAGES

### 7.1 Web App (`@shm/web`)
```typescript
// frontend/apps/web/package.json
"@shm/shared": "workspace:*"

// Usage in components
import { hmId, useRouteLink } from '@shm/shared'
import { useAccount } from '@shm/shared/models/entity'
import { ActivityProvider } from '@shm/shared/activity-service-provider'
```

### 7.2 Desktop App (`@shm/desktop`)
```typescript
// frontend/apps/desktop/package.json
"@shm/shared": "workspace:*"

// Similar imports pattern
```

### 7.3 UI Package (`@shm/ui`)
```typescript
// frontend/packages/ui/package.json
"@shm/shared": "workspace:*"
```

### 7.4 Editor Package (`@shm/editor`)
```typescript
// frontend/packages/editor/package.json
"@shm/shared": "workspace:*"

// Editor has its own TypeScript paths
"@shm/shared/*": ["../shared/src/*"],
```

---

## 8. IMPORTANT CONVENTIONS

### 8.1 Module Organization
1. **Top-level files** (`index.ts`, `hm-types.ts`, etc.) - Core types and utilities
2. **`client/` directory** - gRPC-related code
   - `.generated/` - Auto-generated from .proto files
   - Custom utilities and type helpers
3. **`models/` directory** - Data models and business logic
   - React hooks for queries
   - Service implementations
4. **`utils/` directory** - Reusable utility functions
   - Organized by concern
   - Can have co-located tests

### 8.2 Export Rules
1. Always export via `index.ts` for public API
2. Sub-modules can be imported directly for code splitting
3. Use barrel exports (index.ts) in subdirectories
4. Keep private utilities as private imports

### 8.3 TypeScript Patterns
1. Use Zod for runtime-validated types
2. Export both type and schema when validating at runtime
3. Use `z.infer<typeof Schema>` for type inference
4. Path aliases resolve `@shm/ui/*` and `@shm/shared/*`

### 8.4 Build Process
1. Always run `yarn workspace @shm/shared build:types` before `yarn typecheck`
2. This generates `dist/` with all `.d.ts` declarations
3. Other packages depend on these built types

---

## 9. CREATING A GRAPHQL CLIENT MODULE

### 9.1 Option A: Add to @shm/shared (Recommended for small/core module)

**File Structure:**
```
src/
  graphql/
    index.ts                       # Main export
    client.ts                      # Client factory
    queries.ts                     # GraphQL queries
    mutations.ts                   # GraphQL mutations
    types.ts                       # GraphQL types
    hooks.ts                       # React hooks (useQuery, useMutation)
    __tests__/
      client.test.ts
```

**Add to `index.ts`:**
```typescript
export * from './graphql'
```

**Create `graphql/index.ts`:**
```typescript
export * from './client'
export * from './queries'
export * from './mutations'
export * from './types'
export * from './hooks'
```

### 9.2 Option B: Create new @shm/graphql package (Better for complexity)

**File: `frontend/packages/graphql/package.json`**
```json
{
  "name": "@shm/graphql",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./dist/index.d.ts",
  "scripts": {
    "format:check": "prettier --check .",
    "format:write": "prettier --write .",
    "typecheck": "tsc --noEmit",
    "build:types": "tsc -p tsconfig.types.json",
    "test": "vitest --run",
    "test:w": "vitest"
  },
  "dependencies": {
    "@shm/shared": "workspace:*",
    "@apollo/client": "latest",
    "graphql": "latest"
  },
  "devDependencies": {
    "typescript": "5.8.3",
    "vitest": "0.34.2"
  }
}
```

**File: `frontend/packages/graphql/tsconfig.json`**
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

**File: `frontend/packages/graphql/tsconfig.app.json`**
```json
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noImplicitReturns": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "allowUnreachableCode": false,
    "allowUnusedLabels": false,
    "paths": {
      "@shm/shared/*": ["../shared/src/*"],
      "@shm/ui/*": ["../ui/src/*"]
    }
  },
  "include": ["src"]
}
```

**File: `frontend/packages/graphql/tsconfig.types.json`**
```json
{
  "extends": "./tsconfig.app.json",
  "compilerOptions": {
    "declaration": true,
    "emitDeclarationOnly": true,
    "declarationMap": false,
    "outDir": "./dist",
    "noEmit": false,
    "incremental": false,
    "composite": false,
    "allowImportingTsExtensions": false,
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "**/*.test.ts", "**/*.test.tsx"]
}
```

**File: `frontend/packages/graphql/src/index.ts`**
```typescript
export * from './client'
export * from './queries'
export * from './mutations'
export * from './types'
export * from './hooks'
```

**Update Root `package.json` workspaces:**
```json
"workspaces": [
  "frontend/packages/shared",
  "frontend/packages/ui",
  "frontend/packages/editor",
  "frontend/packages/graphql",  // ADD THIS
  // ... rest of workspaces
]
```

### 9.3 Usage in Apps
```typescript
// After setting up module
import { useGraphQLQuery, useGraphQLMutation } from '@shm/graphql'
// or
import { createGraphQLClient } from '@shm/graphql'
```

---

## 10. KEY TAKEAWAYS FOR NEW MODULES

1. **Follow the barrel pattern** - Always export via index.ts
2. **Use TypeScript paths** - Keep consistent with @shm/* naming
3. **Organize by concern** - Separate models, utils, types
4. **Build types first** - `build:types` generates dist/ declarations
5. **Test alongside code** - Use `*.test.ts` or `__tests__/` directories
6. **Document zod schemas** - Export both types and schemas for validation
7. **Use React Query keys** - Centralize in `query-keys.ts`
8. **Keep workspace consistent** - Follow existing tsconfig patterns
