# Backend

Status: current.

The backend is the Go runtime for Seed. It contains the daemon, API implementations, blob formats/indexing, SQLite
storage, P2P networking, and backend tests.

## Package map

| Path                                               | Ownership                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [`api`](./api)                                     | gRPC service implementations and API test helpers. Mirrors `proto/**` service areas.                                                   |
| [`api/documents/v3alpha`](./api/documents/v3alpha) | Documents, resources, comments, contacts, access control, document history.                                                            |
| [`api/entities/v1alpha`](./api/entities/v1alpha)   | Entity timeline, search, delete/undelete, discovery entry points.                                                                      |
| [`api/activity/v1alpha`](./api/activity/v1alpha)   | Activity feed and subscription APIs.                                                                                                   |
| [`api/daemon/v1alpha`](./api/daemon/v1alpha)       | Daemon admin/key/vault/domain APIs.                                                                                                    |
| [`blob`](./blob)                                   | Signed blob formats (`Change`, `Ref`, `Comment`, `Capability`, profile/contact), blob store/indexing, visibility propagation.          |
| [`storage`](./storage)                             | SQLite store, schema source of truth, migrations, local vault storage. Read [`storage/AGENTS.md`](./storage/AGENTS.md) before editing. |
| [`hmnet`](./hmnet)                                 | libp2p node, Bitswap/file serving, peer/debug endpoints, P2P client/server plumbing.                                                   |
| [`hmnet/syncing`](./hmnet/syncing)                 | Authorized sync, discovery, scheduling, sync server.                                                                                   |
| [`daemon`](./daemon)                               | App composition: storage, index, network, sync, gRPC, HTTP, metrics, reindexing, LLM embedding.                                        |
| [`cmd/seed-daemon`](./cmd/seed-daemon)             | CLI entry point for the daemon binary.                                                                                                 |
| [`core`](./core)                                   | Cryptography, principals, key pairs, keystores, mnemonics.                                                                             |
| [`config`](./config)                               | Daemon configuration and defaults.                                                                                                     |
| [`llm`](./llm)                                     | Embedding backends and llama.cpp/Ollama integration.                                                                                   |
| [`util`](./util)                                   | Shared Go utilities; keep new helpers small and justified.                                                                             |

## Sources of truth

- Proto contracts: [`../proto`](../proto).
- DB schema: [`storage/schema.sql`](./storage/schema.sql).
- DB migrations: [`storage/storage_migrations.go`](./storage/storage_migrations.go).
- Blob formats: [`blob/blob_*.go`](./blob).
- Daemon composition: [`daemon/daemon.go`](./daemon/daemon.go).

## Common commands

```bash
go test ./backend/...
golangci-lint run --new-from-merge-base origin/main ./backend/...
go install ./backend/...           # compile-only check
./dev run-backend -- -http.port=53001 -grpc.port=53002 -p2p.port=53000
./dev gen //backend/...             # after generated schema/proto-affecting changes
```

For local CI parity before pushing, use the backend workflows from
[`../docs/local-ci-with-agent-ci.md`](../docs/local-ci-with-agent-ci.md).
