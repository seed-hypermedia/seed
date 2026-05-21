# Developer setup

Status: current.

This repo uses `pnpm` for the main workspace and `bun` only inside `vault/**`. The root [`./dev`](../dev) script is the
main entrypoint for day-to-day commands.

## Prerequisites

- macOS or Linux.
- [`mise`](https://mise.jdx.dev/) for pinned toolchains from [`mise.toml`](../mise.toml).
- [`direnv`](https://direnv.net/) so entering the repo activates those tools.
- Docker Desktop if you plan to run local CI with agent-ci.

`mise.toml` pins Go, Node, pnpm, Bun, Please (`plz`), protoc, CMake, and golangci-lint. Let `direnv` install and
activate them instead of manually mixing system versions.

## First-time setup

```bash
# from the repo root
direnv allow .
pnpm install
./dev
```

`direnv allow .` may take several minutes the first time because it initializes the `llama-go` submodule, builds local
llama.cpp libraries, and downloads the embedding model used by the daemon.

If `./dev` says direnv is not enabled, open a new shell in the repo or run `direnv reload`.

## Common commands

```bash
./dev run-desktop          # desktop app in dev mode
./dev run-desktop-mainnet  # desktop dev build pointed at mainnet
./dev build-desktop        # package desktop for the current platform
./dev run-web              # web app dev server
./dev build-web            # production web build
./dev run-backend -- -http.port=53001 -grpc.port=53002 -p2p.port=53000
./dev gen                  # check and refresh generated code
```

Useful direct pnpm commands:

```bash
pnpm test
pnpm typecheck
pnpm format:write
pnpm web:test
pnpm shared:test
pnpm desktop:test:unit
pnpm web:standalone       # backend + web together on local ports
pnpm notify:standalone    # backend + notify together on local ports
```

## Web app local run notes

The web app talks to a Seed daemon over HTTP/gRPC-web-compatible endpoints. The simplest path is usually:

```bash
pnpm web:standalone
```

For separate processes, run a daemon first and then the web app with matching environment variables:

```bash
./dev run-backend -- -http.port=58001 -grpc.port=58002 -p2p.port=58000 -data-dir="$PWD/.dev-data/web"
pnpm web
```

See [`frontend/apps/web/README.md`](../frontend/apps/web/README.md) for route and SSR details.

## Backend checks

```bash
go test ./backend/...
golangci-lint run --new-from-merge-base origin/main ./backend/...
go install ./backend/... # compile-only check
```

When changing `backend/storage/schema.sql`, also update migrations and run:

```bash
./dev gen //backend/...
```

## Frontend checks

```bash
pnpm typecheck
pnpm test
pnpm audit
pnpm format:write
```

For targeted packages, use filters, for example:

```bash
pnpm --filter @shm/web test
pnpm --filter @shm/shared typecheck
pnpm --filter @seed-hypermedia/client test
```

## Vault checks

`vault/**` uses Bun and has its own lockfile:

```bash
cd vault
bun install
bun run check
bun test
bun run build
```

## Local CI before pushing

Use agent-ci for workflow parity before pushing, especially after backend, frontend, vault, or ops changes. See
[`docs/local-ci-with-agent-ci.md`](./local-ci-with-agent-ci.md) for setup and retry commands.
