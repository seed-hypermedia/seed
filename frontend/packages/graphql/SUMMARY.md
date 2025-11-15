# @shm/graphql Package Summary

## What Was Built

A standalone GraphQL client package with normalized caching for Hypermedia resources.

## Package Structure

```
frontend/packages/graphql/
├── src/
│   ├── __tests__/
│   │   ├── cache.test.ts           # Cache config unit tests (4 passing)
│   │   ├── types.test.ts           # Type utilities unit tests (6 passing)
│   │   └── client.integration.test.ts  # Integration tests (skipped)
│   ├── cache.ts                    # Graphcache normalization config
│   ├── client.ts                   # Client creation & management
│   ├── hooks.ts                    # React hooks (useResource, useComments, useHello)
│   ├── provider.tsx                # React context provider
│   ├── queries.ts                  # GraphQL query strings with fragments
│   ├── types.ts                    # TypeScript types & utilities
│   └── index.ts                    # Main exports
├── dist/                           # Built type definitions
├── package.json                    # Package config with urql deps
├── tsconfig.*.json                # TypeScript configs
├── vitest.config.ts               # Test configuration
└── README.md                       # Usage documentation
```

## Key Features

### 1. Normalized Caching

Resources are cached by account ID and path, not by full IRI:

```
Cache Key Format: Account:<accountId>:Resource:<path>
```

This means:
- `hm://account123/docs/my-doc`
- `hm://account123/docs/my-doc?v=version1`
- `hm://account123/docs/my-doc?v=version2`

All map to the same cache entry: `Account:account123:Resource:docs/my-doc`

### 2. Account-Based Structure

Each account contains:
- **Profile**: Cached as `Account:<accountId>:Profile`
- **Resources**: Map of path → resource

```typescript
interface NormalizedAccount {
  id: string                                    // Account ID
  profile: NormalizedProfile | null             // Profile resource
  resources: Map<string, NormalizedResource>    // path → resource
}
```

### 3. React Hooks

Three main hooks exported:

```typescript
// Fetch any resource by IRI
useResource(iri: string, pause?: boolean)

// Fetch comments for a document
useComments(iri: string, options?: {
  pageSize?: number
  pageToken?: string
  pause?: boolean
})

// Health check
useHello(pause?: boolean)
```

### 4. TypeScript Types

Comprehensive type definitions for:
- Document & Comment resources
- Block content (flattened structure)
- All block types (Paragraph, Heading, Code, Image, etc.)
- Annotations (Bold, Italic, Link, etc.)
- Profile data

### 5. Utilities

```typescript
parseHmIri(iri: string)  // Parse IRI into {account, path, version}
buildHmIri(account, path, version?)  // Build IRI from components
```

## Usage Example

```tsx
import {GraphQLProvider, useResource} from '@shm/graphql'

// 1. Wrap app with provider
function App() {
  return (
    <GraphQLProvider options={{
      url: 'http://localhost:58001/hm/api/graphql'
    }}>
      <DocumentView iri="hm://account123/docs/my-doc" />
    </GraphQLProvider>
  )
}

// 2. Use hooks in components
function DocumentView({iri}: {iri: string}) {
  const result = useResource(iri)

  if (result.fetching) return <div>Loading...</div>
  if (result.error) return <div>Error: {result.error.message}</div>

  const doc = result.data?.getResource
  if (doc?.__typename === 'Document') {
    return <h1>{doc.name}</h1>
  }

  return null
}
```

## Testing

- **Unit tests**: 10 passing tests for cache config and type utilities
- **Integration tests**: Written but skipped (require daemon)
- **Type checking**: Full TypeScript strict mode
- **Build**: Type definitions generated successfully

## Integration with GraphQL Server

Designed to work with the GraphQL API in `frontend/apps/web/app/graphql/`:

- Same type definitions for resources, blocks, annotations
- Compatible query structure
- Uses the `/hm/api/graphql` endpoint from web app

## Next Steps for apps/explore

To use this package in `apps/explore`:

1. Add dependency:
```json
{
  "dependencies": {
    "@shm/graphql": "workspace:*"
  }
}
```

2. Wrap app with provider:
```tsx
import {GraphQLProvider} from '@shm/graphql'

<GraphQLProvider options={{url: GRAPHQL_ENDPOINT}}>
  <ExploreApp />
</GraphQLProvider>
```

3. Use hooks in components:
```tsx
import {useResource} from '@shm/graphql'

function ResourceView({iri}: {iri: string}) {
  const {data, fetching, error} = useResource(iri)
  // ... render resource
}
```

## Benefits

1. **Normalized**: Efficient caching prevents duplicate data
2. **Type-safe**: Full TypeScript support with strict checking
3. **Flexible**: Works with any HM IRI
4. **Tested**: Unit tests cover core functionality
5. **Documented**: README with examples and API reference
6. **Self-contained**: No dependencies on @shm/shared (only urql)

## Files Modified

- Created new package: `frontend/packages/graphql/`
- Updated: `yarn.lock` (added urql dependencies)
- No changes to existing packages needed

## Commits

- Commit 1: GraphQL API (Pothos + Yoga server in web app)
- Commit 2: @shm/graphql client package (this package)
