# GraphQL API Documentation

## Overview

The web app uses **Pothos GraphQL** (TypeScript-first schema builder) + **GraphQL Yoga** (modern GraphQL server) to provide a GraphQL API over the gRPC backend.

**Stack:**
- **Pothos**: Type-safe, code-first schema builder
- **GraphQL Yoga**: GraphQL server with Remix integration
- **gRPC backend**: All data fetching happens via gRPC calls to seed-daemon

## Architecture

```
Client Request
    ↓
/hm/api/graphql (Remix route)
    ↓
GraphQL Yoga (GraphQL server)
    ↓
Pothos Schema (type definitions + resolvers)
    ↓
gRPC Client (seed-daemon calls)
    ↓
seed-daemon (Go backend)
```

## File Structure

```
frontend/apps/web/app/graphql/
├── README.md                        # This file
├── schema.ts                        # Schema definitions & resolvers
├── test-utils.ts                    # Test helpers (urql client)
└── graphql.integration.test.ts      # Integration tests

frontend/apps/web/app/routes/
└── hm.api.graphql.tsx              # Remix route handler
```

## Writing Schemas & Resolvers

### Location: `app/graphql/schema.ts`

All GraphQL types, queries, mutations, and resolvers live here.

### Schema Builder Pattern

Pothos uses a **builder pattern** where you define types and their fields:

```typescript
// 1. Create schema builder function (accepts grpcClient for DI)
export function createSchema(grpcClient: GRPCClients) {
  const builder = new SchemaBuilder<{
    Objects: {
      Resource: ResourceModel  // Define backing models
    }
  }>({})

  // 2. Define GraphQL interfaces
  const ResourceInterface = builder.interfaceRef<ResourceModel>('Resource')
  ResourceInterface.implement({
    description: 'A Hypermedia resource',
    fields: (t) => ({
      iri: t.exposeString('iri', {
        description: 'The IRI identifier',
      }),
      version: t.string({
        nullable: true,
        resolve: (resource) => resource.version || null,
      }),
    }),
  })

  // 3. Define concrete types implementing interface
  builder.objectType('Document', {
    description: 'A document resource',
    interfaces: [ResourceInterface],
    isTypeOf: (obj) => obj.kind === 'document',
    fields: (t) => ({
      account: t.string({resolve: (doc) => doc.data.account}),
      path: t.string({resolve: (doc) => doc.data.path}),
      name: t.string({resolve: (doc) => doc.data.metadata.name}),
    }),
  })

  // 4. Define queries
  builder.queryType({
    fields: (t) => ({
      hello: t.string({
        description: 'Health check',
        resolve: () => 'Hello from Seed GraphQL API',
      }),

      getResource: t.field({
        type: ResourceInterface,  // Returns interface type
        args: {
          iri: t.arg.string({ required: true }),
        },
        resolve: async (_parent, args) => {
          // Call gRPC backend
          const request = new GetResourceRequest({ iri: args.iri })
          const response = await grpcClient.resources.getResource(request)

          // Map gRPC response to backing model
          if (response.kind.case === 'document') {
            return {
              kind: 'document' as const,
              iri: args.iri,
              version: response.version,
              data: response.kind.value,
            }
          } else if (response.kind.case === 'comment') {
            return {
              kind: 'comment' as const,
              iri: args.iri,
              version: response.version,
              data: response.kind.value,
            }
          }
          throw new Error(`Unsupported resource type: ${response.kind.case}`)
        },
      }),
    }),
  })

  // 5. Build and return schema
  return builder.toSchema()
}
```

### Adding a New Query

**Example: Add `listDocuments` query**

```typescript
// 1. Define backing model (optional if using proto types directly)
interface DocumentModel {
  id: string
  title: string
  author: string
}

// 2. Add to builder's type definitions
const builder = new SchemaBuilder<{
  Objects: {
    Resource: ResourceModel
    Document: DocumentModel  // Add new type
  }
}>({})

// 3. Define the GraphQL type
builder.objectType('Document', {
  description: 'A Hypermedia document',
  fields: (t) => ({
    id: t.exposeString('id'),
    title: t.exposeString('title'),
    author: t.exposeString('author'),
  }),
})

// 4. Add query in queryType fields
builder.queryType({
  fields: (t) => ({
    // ... existing queries

    listDocuments: t.field({
      type: ['Document'],  // Array of Documents
      args: {
        limit: t.arg.int({ required: false, defaultValue: 10 }),
      },
      resolve: async (_parent, args) => {
        // Call gRPC
        const request = new ListDocumentsRequest({ limit: args.limit })
        const response = await grpcClient.documents.listDocuments(request)

        // Map response
        return response.documents.map(doc => ({
          id: doc.id,
          title: doc.title,
          author: doc.author,
        }))
      },
    }),
  }),
})
```

### Adding a Mutation

```typescript
builder.mutationType({
  fields: (t) => ({
    createDocument: t.field({
      type: 'Document',
      args: {
        title: t.arg.string({ required: true }),
        content: t.arg.string({ required: true }),
      },
      resolve: async (_parent, args) => {
        const request = new CreateDocumentRequest({
          title: args.title,
          content: args.content,
        })
        const response = await grpcClient.documents.createDocument(request)

        return {
          id: response.id,
          title: response.title,
          author: response.author,
        }
      },
    }),
  }),
})
```

## Remix Route Handler

### Location: `app/routes/hm.api.graphql.tsx`

This file creates the HTTP endpoint. **Rarely needs modification.**

```typescript
import {createYoga} from 'graphql-yoga'
import {schema} from '../graphql/schema'

const yoga = createYoga({
  schema: schema(),  // Get schema from factory
  graphiql: process.env.NODE_ENV === 'development',
})

export const loader = async ({request}) => yoga.fetch(request, {})
export const action = async ({request}) => yoga.fetch(request, {})
```

**Don't modify this unless:**
- Adding custom Yoga plugins
- Changing CORS settings
- Adding custom context

## Schema Injection Pattern

The schema uses **dependency injection** for the gRPC client:

```typescript
// Factory function accepts client
export function createSchema(grpcClient: GRPCClients) {
  // Schema definition uses injected client
}

// Lazy-loaded for Remix route (uses server client)
export const schema = () => {
  if (!_cachedSchema) {
    const {grpcClient} = require('../client.server')
    _cachedSchema = createSchema(grpcClient)
  }
  return _cachedSchema
}
```

**Why this pattern?**
- Tests can inject mock/test gRPC client
- Remix route uses production client
- No global singletons

## Testing

### Integration Tests

Location: `app/graphql/graphql.integration.test.ts`

Tests spawn a real daemon and execute queries against it:

```typescript
// 1. Daemon spawns in beforeAll with isolated test DB
daemonProcess = spawn('go', ['run', DAEMON_CODE_PATH, ...])

// 2. Create test client connected to test daemon
const testTransport = createGrpcWebTransport({
  baseUrl: `http://localhost:${DAEMON_HTTP_PORT}`,
})
const testGrpcClient = createGRPCClient(testTransport)

// 3. Create schema with test client
testSchema = createSchema(testGrpcClient)
yoga = createYoga({schema: testSchema})

// 4. Execute queries
const response = await yoga.fetch('http://test/graphql', {
  method: 'POST',
  body: JSON.stringify({query, variables}),
})
```

### Writing a New Test

```typescript
it('should list documents', async () => {
  const query = `
    query {
      listDocuments(limit: 5) {
        id
        title
        author
      }
    }
  `

  const response = await yoga.fetch('http://test/graphql', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query}),
  })

  const result = await response.json()

  expect(result.errors).toBeUndefined()
  expect(result.data?.listDocuments).toHaveLength(5)
})
```

### Run Tests

```bash
yarn web:test run graphql.integration.test.ts
```

## GraphiQL Interface

In development, visit `/hm/api/graphql` in browser for interactive GraphQL playground.

**Example query:**
```graphql
query {
  hello
  getResource(iri: "hm://some-account/some-doc") {
    iri
    version
    __typename
    ... on Document {
      account
      path
      name
    }
    ... on Comment {
      id
      authorId
    }
  }
}
```

## Type Safety

Pothos provides **full type inference**:

```typescript
// TypeScript knows the shape of backing models
type ResourceModel = DocumentModel | CommentModel

interface DocumentModel {
  kind: 'document'
  iri: string
  version?: string
  data: ProtoDocument
}

// Pothos infers field types and validates at compile time
builder.objectType('Document', {
  interfaces: [ResourceInterface],
  fields: (t) => ({
    iri: t.exposeString('iri'),  // ✓ TypeScript knows 'iri' is string
    account: t.string({
      resolve: (doc) => doc.data.account  // ✓ TypeScript knows doc.data is ProtoDocument
    }),
    // @ts-expect-error
    foo: t.exposeString('foo'),  // ✗ TypeScript error: 'foo' not on DocumentModel
  }),
})
```

## Common Patterns

### Nullable Fields

```typescript
version: t.string({
  nullable: true,
  resolve: (resource) => resource.version || null,
})
```

### Field Arguments

```typescript
getResource: t.field({
  args: {
    iri: t.arg.string({ required: true }),
    version: t.arg.string({ required: false }),
  },
  resolve: async (_parent, args) => {
    // args.iri is string
    // args.version is string | undefined
  },
})
```

### Complex Types

```typescript
// Return array of objects
listDocuments: t.field({
  type: ['Document'],
  resolve: async () => [...],
})

// Nested objects
author: t.field({
  type: 'User',
  resolve: (doc) => ({
    id: doc.authorId,
    name: doc.authorName,
  }),
})
```

### Error Handling

```typescript
resolve: async (_parent, args) => {
  try {
    const response = await grpcClient.resources.getResource(args)
    return mapResponse(response)
  } catch (error) {
    // GraphQL automatically wraps errors
    throw new Error(`Failed to fetch resource: ${error.message}`)
  }
}
```

## Mapping gRPC to GraphQL

### Oneof Fields (Union Types)

gRPC `oneof` becomes discriminated union:

```typescript
// gRPC proto:
// message Resource {
//   oneof kind {
//     Document document = 1;
//     Comment comment = 2;
//   }
// }

// GraphQL mapping:
const response = await grpcClient.resources.getResource(request)

if (response.kind.case === 'document') {
  return {
    kind: 'document',
    data: response.kind.value,  // Document proto
  }
} else if (response.kind.case === 'comment') {
  return {
    kind: 'comment',
    data: response.kind.value,  // Comment proto
  }
}
```

### Proto Messages to GraphQL Types

```typescript
// gRPC proto message → GraphQL backing model
interface DocumentModel {
  id: string           // from proto Document.id
  title: string        // from proto Document.title
  createdAt: Date      // from proto Document.created_at
}

// Resolver maps proto to model
resolve: async () => {
  const protoDoc = await grpcClient.documents.get(...)

  return {
    id: protoDoc.id,
    title: protoDoc.title,
    createdAt: new Date(protoDoc.createdAt.seconds * 1000),
  }
}
```

## Best Practices

1. **Keep resolvers thin** - Business logic stays in gRPC backend
2. **Use backing models** - Separate GraphQL types from proto types
3. **Test with real daemon** - Integration tests ensure gRPC compatibility
4. **Document fields** - Add descriptions to all types and fields
5. **Handle errors gracefully** - Wrap gRPC errors with context
6. **Use fragments** - Reuse common field selections in queries

## Resources

- [Pothos Docs](https://pothos-graphql.dev/)
- [GraphQL Yoga Docs](https://the-guild.dev/graphql/yoga-server)
- [GraphQL Spec](https://spec.graphql.org/)
