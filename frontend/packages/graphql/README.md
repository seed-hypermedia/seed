# @shm/graphql

GraphQL client for Hypermedia resources with normalized caching.

## Features

- **urql-based** - Modern GraphQL client with React hooks
- **Normalized caching** - Resources cached by account ID and path
- **Type-safe** - Full TypeScript support
- **Account-based structure** - Organizes resources as Account → Profile + Resources
- **Flattened blocks** - Document content with normalized block structure

## Installation

```bash
yarn add @shm/graphql
```

## Usage

### Basic Setup

```tsx
import {GraphQLProvider, createGraphQLClient} from '@shm/graphql'

// Create client
const client = createGraphQLClient({
  url: 'http://localhost:58001/hm/api/graphql',
})

// Wrap app with provider
function App() {
  return (
    <GraphQLProvider client={client}>
      <YourApp />
    </GraphQLProvider>
  )
}
```

### Hooks

#### useResource - Fetch a resource by IRI

```tsx
import {useResource} from '@shm/graphql'

function DocumentView({iri}: {iri: string}) {
  const result = useResource(iri)

  if (result.fetching) return <div>Loading...</div>
  if (result.error) return <div>Error: {result.error.message}</div>

  const resource = result.data?.getResource

  if (resource?.__typename === 'Document') {
    return (
      <div>
        <h1>{resource.name}</h1>
        <p>Account: {resource.account}</p>
        <p>Path: {resource.path}</p>
      </div>
    )
  }

  return null
}
```

#### useComments - Fetch comments for a document

```tsx
import {useComments} from '@shm/graphql'

function Comments({documentIri}: {documentIri: string}) {
  const result = useComments(documentIri, {
    pageSize: 20,
  })

  if (result.fetching) return <div>Loading comments...</div>
  if (result.error) return <div>Error loading comments</div>

  const comments = result.data?.getResource.discussions || []

  return (
    <div>
      {comments.map((comment) => (
        <div key={comment.id}>
          <p>By: {comment.author.name || comment.authorId}</p>
          <div>{/* Render comment content */}</div>
        </div>
      ))}
    </div>
  )
}
```

## Cache Structure

Resources are normalized by account and path:

```
Cache Key Format: Account:<accountId>:Resource:<path>
```

Example:
- IRI: `hm://account123/docs/my-doc`
- Cache Key: `Account:account123:Resource:docs/my-doc`

This means different versions of the same resource share the same cache entry, ensuring consistency.

### Account Structure

Each account contains:
- **Profile**: `Account:<accountId>:Profile`
- **Resources**: Key-value store where key = path

```typescript
interface NormalizedAccount {
  id: string
  profile: NormalizedProfile | null
  resources: Map<string, NormalizedResource>
}
```

## API Reference

### Client

```typescript
createGraphQLClient(options: GraphQLClientOptions): Client
getDefaultGraphQLClient(url?: string): Client
resetDefaultGraphQLClient(): void
```

### Provider

```typescript
<GraphQLProvider
  client?: Client
  options?: GraphQLClientOptions
>
  {children}
</GraphQLProvider>
```

### Hooks

```typescript
useResource(iri: string, pause?: boolean): UseQueryResponse
useComments(iri: string, options?: {
  pageSize?: number
  pageToken?: string
  pause?: boolean
}): UseQueryResponse
useHello(pause?: boolean): UseQueryResponse
```

### Utilities

```typescript
parseHmIri(iri: string): {account: string; path: string; version?: string} | null
buildHmIri(account: string, path: string, version?: string): string
```

## Types

All TypeScript types are exported:

```typescript
import type {
  NormalizedAccount,
  NormalizedProfile,
  NormalizedDocument,
  NormalizedComment,
  NormalizedResource,
  BlocksContent,
  BlockNode,
  Block,
  Annotation,
} from '@shm/graphql'
```

## Testing

```bash
# Run unit tests
yarn test

# Run type checking
yarn typecheck

# Build types
yarn build:types
```

## Integration Tests

Integration tests require a running daemon. To run:

```bash
# Ensure Go is installed and daemon can be built
go version

# Run integration tests (spawns daemon automatically)
yarn test
```

Integration tests are currently skipped by default. Remove `.skip` from the test suite to enable.

## Architecture

- **client.ts** - Client creation and configuration
- **cache.ts** - Graphcache normalization config
- **queries.ts** - GraphQL query strings
- **hooks.ts** - React hooks for queries
- **provider.tsx** - React context provider
- **types.ts** - TypeScript types and utilities

## License

ISC
