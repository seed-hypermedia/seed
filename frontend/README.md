# Seed Hypermedia Frontend monorepo

## Development

- [run sites locally](./apps/web/README.md)

## GraphQL

### Overview

2 GraphQL implementations:

1. **Server** ([frontend/apps/web/app/graphql](apps/web/app/graphql/)) - Pothos + Yoga server exposing gRPC backend via GraphQL
2. **Client** ([frontend/packages/graphql](packages/graphql/)) - urql-based client with normalized caching

### Test Commands

**Server Integration Tests:**
```bash
# Run from repo root
yarn web:test run graphql.integration.test.ts

# Or run specific test file
yarn web:test run app/graphql/graphql.integration.test.ts
```

**Client Integration Tests:**
```bash
# Run from repo root
yarn workspace @shm/graphql test run client.integration.test.ts

# Run all client tests
yarn workspace @shm/graphql test
```

### Automatic Daemon Management

Both integration test suites **automatically spawn and manage the daemon**:

- `beforeAll()`:
  - Kills any processes on test ports (prevents conflicts)
  - Spawns daemon with isolated test DB
  - Waits for ready signal
- Tests execute against running daemon
- `afterAll()`: Kills daemon, cleans up test DB

No manual daemon setup required. Tests use dedicated ports (59001-59002 for server, 59101-59103 for client) to avoid conflicts with dev environment.

### Test Fixtures

Test data is stored in `test-fixtures/daemon/` (checked into repo). Before each test run:
- Fixtures copied to temporary directory in OS tmpdir
- Daemon runs against temp copy
- Temp directory cleaned up after tests

This keeps checked-in fixtures pristine while allowing tests to modify data.

### Test Isolation

Each test suite uses separate:
- Temporary runtime directories (copied from `test-fixtures/`)
- HTTP/gRPC/P2P ports
- Testnet configuration (`SEED_P2P_TESTNET_NAME=test`)

### Documentation

- **Server API**: [frontend/apps/web/app/graphql/README.md](apps/web/app/graphql/README.md)
- **Client Package**: [frontend/packages/graphql/README.md](packages/graphql/README.md)
