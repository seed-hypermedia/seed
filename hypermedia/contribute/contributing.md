---
name: Contributing
summary: How to find your way around the Seed repository, set it up, run the development stack, run the checks each part expects, and make the changes that have special rules.
---
Seed is one public repository, [github.com/seed-hypermedia/seed](https://github.com/seed-hypermedia/seed), holding the [Go daemon](../software/daemon.md), the TypeScript apps and libraries, the [agent runtime](../agent.md), the [vault](../software/vault.md), deployment tooling, and the markdown for this site. This page is for people who want to change any of it. It covers the layout, the one-command development stack, the checks each area expects before a pull request, and the rules for the changes that are hard to undo: storage migrations and protocol changes. [Working on Seed](../contribute.md) lists the other contributor guides. <!-- id:_zvH8SHk -->

The repository keeps instructions for coding agents in `AGENTS.md` at the root and in the subtrees listed below. They are written for humans too, and they are the authoritative version of the rules summarized here. <!-- id:vX8_MKKR -->

# The repository <!-- id:ml67ascN -->

<!-- id:qkA7gG_e -->
| Path <!-- col:iWguLxEY --> | What lives there <!-- col:x03VL8Ja --> | Toolchain <!-- col:YTGiImZw --> <!-- id:-Wd8HBYw --> |
| --- | --- | --- |
| `backend/` | the [Seed daemon](../software/daemon.md): storage and indexing (`storage/`, `blob/`), the document model and CRDTs (`api/documents/`, `crdt/`), networking (`hmnet/`), gRPC APIs (`api/`), the embedding model (`llm/`) | Go, built with Please <!-- id:H2EwgJQj --> |
| `proto/` | protobuf definitions for every daemon service; generated Go and TypeScript are checked in | Please, `./dev gen` <!-- id:0NSWiC7J --> |
| `frontend/apps/desktop` | the [Seed app](../software/desktop.md) (Electron) | pnpm <!-- id:Zbe5Pvw9 --> |
| `frontend/apps/web` | the [Seed web app](../software/web.md) that serves sites, the [Seed API](../build/web-api.md) and site services (Remix) | pnpm <!-- id:0CIOxjFE --> |
| `frontend/apps/cli` | `seed-cli`, also the home of the `hypermedia/` sync script | pnpm workspace, runs under Bun <!-- id:2PI-xaLm --> |
| `frontend/apps/notify` | the email [notification service](../software/notify.md) | pnpm <!-- id:1XZADdbO --> |
| `frontend/apps/explore` | the [Hypermedia Explorer](../software/explorer.md) | pnpm <!-- id:jIim84ro --> |
| `frontend/apps/mobile` | the [React Native app](../software/mobile.md), outside the pnpm workspace | npm <!-- id:RqovKZdX --> |
| `frontend/apps/landing`, `emails`, `perf-web`, `performance`, `performance-dashboard` | the landing site, email templates, performance tooling | pnpm <!-- id:-PiCtbX7 --> |
| `frontend/packages/client` | `@seed-hypermedia/client`, the [published SDK](../build/sdk.md) | pnpm <!-- id:8NqjCj-r --> |
| `frontend/packages/shared`, `ui`, `editor` | shared models and hooks (`@shm/shared`), UI components (`@shm/ui`), the editor (`@shm/editor`) | pnpm <!-- id:cUHLxKb5 --> |
| `apps/` | the [app environment](../software/app-environment.md), the server that runs [Seed Agents](../agent.md); see [Development](./development.md) | its own Bun workspace <!-- id:qOYduI_0 --> |
| `vault/` | the [key vault service](../software/vault.md) | its own Bun workspace <!-- id:7uVXnFiT --> |
| `hypermedia/` | this site: concept pages, the [Hypermedia Schemas](../schema.md) library, the references and guides; see [Editing these docs](./editing-these-docs.md) | markdown, `scripts/hypermedia/` <!-- id:KGtdocvh --> |
| `ops/` | the [self-hosted node](../operate/self-hosting.md) deployment script (`seed-deploy`) | pinned Bun <!-- id:sKjHiyy5 --> |
| `tests/` | cross-app integration tests | pnpm, Vitest, Playwright <!-- id:jLogi_RO --> |
| `docs/` | internal design notes, decision records, runbooks and the security audit log; not published | markdown <!-- id:SH8-ft4T --> |

`apps/` and `vault/` copy the frontend packages they use through `file:` dependencies, so a change to `frontend/packages/*` reaches them only after `bun install`. Their dev servers re-sync automatically. The map pages under [The Seed software](../software.md), such as [Daemon](../software/daemon.md), [Desktop](../software/desktop.md) and [Web](../software/web.md), explain how the programs talk to each other. <!-- id:qypHor4G -->

# Setting up <!-- id:mePBDhAD -->

The toolchain versions are pinned in `mise.toml` and activated by `direnv`. <!-- id:kSqWFI66 -->

Install [mise](https://mise.jdx.dev) and [direnv](https://direnv.net) and hook direnv into your shell, then clone the repository and allow the environment. The first `direnv allow` installs the pinned tools, initializes the `llama-go` submodule, downloads the [embedding model](../software/daemon.md) and builds the llama.cpp libraries, which takes a few minutes. <!-- id:UzZJf2g1 -->

```sh <!-- id:sDnks94Q -->
git clone https://github.com/seed-hypermedia/seed
cd seed
direnv allow
pnpm install
```

Install Docker as well if you want the full stack, because the agents' web search backends run as containers. <!-- id:hd08Yp6V -->

`./dev` refuses to run outside a direnv-enabled shell. From scripts and agents, run commands as `direnv exec . <command>`. <!-- id:nj4bpkxj -->

# Running things <!-- id:FRDrDXTI -->

`./dev` with no arguments lists every command. The ones you will use: <!-- id:v-FeFPO8 -->

<!-- id:pDvelppf -->
| Command <!-- col:nKJRfTtJ --> | What it does <!-- col:jCwY3jCK --> <!-- id:wxmUSi_O --> |
| --- | --- |
| `./dev up` | the whole stack on mainnet in one mprocs window, one pane per process (see `mprocs.yaml`) <!-- id:mNYXdjtH --> |
| `./dev up-testnet` | the same stack on the dev testnet (see `mprocs.testnet.yaml`) <!-- id:nWiElzcx --> |
| `./dev run-desktop` | the desktop app, which builds and spawns its own [daemon](../software/daemon.md) <!-- id:fYOpAbIh --> |
| `./dev run-desktop-mainnet` | the desktop app on mainnet <!-- id:IIoKH2Cu --> |
| `./dev run-backend` | build and run `seed-daemon` alone; flags after `--` go to the daemon <!-- id:MNPxE43L --> |
| `./dev build-backend`, `./dev build-desktop`, `./dev build-web` | production builds <!-- id:h4rT0Hyb --> |
| `./dev test-desktop` | the desktop test suite <!-- id:3VOqRv5u --> |
| `./dev install-cli` | build `seed-cli` and link it into `~/.local/bin` <!-- id:igqhb-0Q --> |
| `./dev hm-sync [dir]` | edit a markdown folder, `hypermedia/` by default, in the desktop dev app <!-- id:W4z8ypJt --> |
| `./dev gen [targets]` | check generated code and regenerate what is stale <!-- id:fuHKv1ew --> |
| `./dev frontend-validate` | format the whole workspace, then check formatting the way CI does <!-- id:NSiF2Mp9 --> |

`./dev up` starts these panes: <!-- id:jkSruR1H -->

<!-- id:KfC-2YD2 -->
| Pane <!-- col:QTd1zqau --> | Process <!-- col:WJ1lZT8f --> | Address <!-- col:yET8czHf --> <!-- id:VHn1ebpI --> |
| --- | --- | --- |
| `backends` | SearXNG and crawl4ai containers for agent web search | :8899, :11235 <!-- id:XPdPUMv7 --> |
| `agents` | the [Seed Agents](../agent.md) server with hot reload | :3051 <!-- id:G4Enzyn8 --> |
| `web` | the web app, talking to the desktop app's daemon | :3000 <!-- id:7pKQKZUk --> |
| `explore` | the Hypermedia Explorer | :5173 <!-- id:Cr3vaUS2 --> |
| `notify` | the notification server | :3060 <!-- id:R9PRrtZx --> |
| `vault` | the vault | :3030 <!-- id:ybGHiFcA --> |
| `desktop` | the Electron app on mainnet with its daemon | daemon HTTP :58001 <!-- id:CnwE-4M0 --> |
| `hm-sync` | the round trip between `hypermedia/` and the desktop app | <!-- id:glFq6Sx0 --> |

In mprocs, `r` restarts the focused process, `s` stops it, `x` starts it and `q` quits everything. Quitting also runs `docker compose down` for the search containers. The development daemon uses ports 58000 to 58004. The full port table is on [Network](../protocol/network.md). <!-- id:yNq5NmzQ -->

Root `package.json` scripts start single apps: `pnpm web`, `pnpm desktop`, `pnpm notify`, `pnpm explore`, `pnpm mobile`, and `pnpm web:standalone`, which runs a web app against its own daemon. <!-- id:rgUFvjTw -->

# Checks before a pull request <!-- id:vQX0hVxi -->

Run the checks for every area you touched. CI runs the same ones, and a single unformatted file anywhere fails the `Lint` job. <!-- id:BDwIhXDx -->

<!-- id:vS3rWxCo -->
| Area <!-- col:-MvRpZjz --> | Commands <!-- col:I-M5rtMN --> <!-- id:uRsCX3t0 --> |
| --- | --- |
| Whole TypeScript workspace | `pnpm typecheck` <!-- id:d94Q1u3R --> |
| Formatting, everywhere | `pnpm format:write`, then `pnpm format:check` from the root; this covers the pnpm workspace, `apps/` and `vault/` <!-- id:mph0fqf0 --> |
| Web, shared, desktop unit tests | `pnpm test` runs all three; singly `pnpm web:test`, `pnpm shared:test`, `pnpm desktop:test:unit` <!-- id:dugjfXvL --> |
| [SDK](../build/sdk.md), UI, editor, notify, explore | `pnpm --filter @seed-hypermedia/client test`, `pnpm --filter @shm/ui test`, `pnpm --filter @shm/editor test`, and the same for `@shm/notify` and `@shm/explore` <!-- id:ofZFP1b2 --> |
| [CLI](../build/cli.md) | `pnpm --filter @seed-hypermedia/cli test` (a fixture suite against a real daemon) and `test:unit` <!-- id:VOFZaWCk --> |
| Desktop end to end | `pnpm desktop:test`, which packages the app and drives it with Playwright <!-- id:Gilwz1nW --> |
| Integration | `pnpm test:integration` from the root <!-- id:x7ufnsyK --> |
| Mobile | `pnpm mobile:test`, `pnpm mobile:typecheck` <!-- id:d-fTb5LC --> |
| Agents | `bun check` and `bun test` in `apps/`; `bun run protocol:check` when you change the agents wire protocol <!-- id:8k_Msi6q --> |
| Vault | `bun check` and `bun test` in `vault/` <!-- id:fxNXvKas --> |
| Dependencies | `pnpm audit --audit-level=high --ignore-registry-errors`, the command the `Security Audit` workflow runs <!-- id:3GkKdSas --> |
| Go | `go test ./backend/...` and `golangci-lint run --new-from-merge-base origin/main ./backend/...` <!-- id:y8N1xXkq --> |
| Docs | `node scripts/hypermedia/check.mjs`; see [Editing these docs](./editing-these-docs.md) <!-- id:n7uUGSnA --> |

In `apps/` and `vault/`, `bun check` runs the type checker and rewrites formatting, so commit whatever it changes. Go tests need the submodule and model that `direnv allow` fetched. CI runs them with `go test -tags cpu --count 1 ./backend/...`. For backend bug fixes, add a failing test first when practical, and use `testify/require` in Go tests. <!-- id:Fo7jkVlG -->

To reproduce CI locally before pushing, use [agent-ci](https://agent-ci.dev). [Local CI with agent-ci](./local-ci.md) has the setup and the command for each area. <!-- id:eVnAHnXe -->

# Changes with special rules <!-- id:kg5ajun_ -->

## Storage schema and migrations <!-- id:9X3SrtbM -->

The [daemon](../software/daemon.md)'s SQLite schema lives in `backend/storage/schema.sql`, which is the source of truth, and migrations live in `backend/storage/storage_migrations.go`. Read the comment at the top of that file before adding one. The rules it sets: <!-- id:PBuNzSFX -->
  - A migration's version is a timestamp from `date +%Y-%m-%d.%H%M%S`, and the list is kept newest first. <!-- id:QnRf8-hL -->
  - Its run function executes in an immediate write transaction and must be as idempotent as possible. <!-- id:dMdOoxSo -->
  - A migration runs only when its version is higher than the data directory's, so never run a feature branch with a migration against a data directory you care about. Back it up first. Switching back to main afterwards fails on the unknown version. <!-- id:8uBgJSVC -->
  - After changing the schema or migrations, run `./dev gen //backend/...`. <!-- id:7oHp9y6v -->
  - Avoid migrations that force a full reindex or recompute embeddings unless you must. CPU-only servers take a long time to redo them. Prefer an additive column and a bounded background backfill. <!-- id:EJFyB_7G -->

When in doubt, ask the backend team before adding a migration. Tag the Go daemon maintainers on pull requests that touch `backend/`. <!-- id:1RS6C3Xu -->

## Protobuf and generated code <!-- id:Pl9dV8uc -->

Edit `.proto` files under `proto/`, then run `./dev gen //proto/...` from the root. Do not run `buf` or `protoc` directly, and do not format the generated code. Proto changes ripple into Go and TypeScript callers, so run the backend and frontend checks above. [gRPC](../build/grpc.md) describes the services for API consumers. <!-- id:elbsSmmW -->

## Protocol changes <!-- id:Db7n9S4a -->

A protocol change is any change to the structure or meaning of permanent data ([blobs](../protocol/blobs.md), [changes](../change.md), [the document graph](../protocol/documents.md), the [CRDT](../protocol/documents.md) rules), the [sync protocol](../protocol/network.md), the [capability model](../protocol/permissions.md), the [identity system](../protocol/identity.md), or any format another implementation must read on disk or over the wire. A feature that can be built purely in an application is not a protocol change. The team's advice is to build it that way first. <!-- id:tPvbLW30 -->

The team's process for a protocol change, as written in its internal methodology notes: <!-- id:xe8WbGn1 -->
  1. Write a proposal note describing the problem and the change. <!-- id:f0kCZNVa -->
  2. Map the arguments for and against it in the open, including rejected alternatives. <!-- id:VImOJ8CK -->
  3. Decide by working through the technical objections. Consensus does not decide. <!-- id:o-O2bJml -->
  4. Update the protocol documentation on this site. <!-- id:YiDYgKHv -->

The process is slow on purpose because published blobs are permanent. Every node that holds old data must keep reading it. <!-- id:-hDpm579 -->

## Deployment tooling <!-- id:v7shYIEe -->

`ops/` is built with the exact Bun version pinned in `ops/package.json`, and CI fails if `ops/dist/deploy.js` is stale. Rebuild it with that version, as `bunx --bun bun@<version> build …`, whenever you change the deploy script. <!-- id:C8p8sJ_w -->

# Releasing and publishing <!-- id:1K6l12Qg -->

Maintainers cut releases with the [Releasing](./releasing.md) runbook. The npm packages publish on their own from `main`, as [Package publishing](./package-publishing.md) explains. [Sentry](./sentry.md) covers error reporting. <!-- id:NpvcWh0F -->

This site is the `hypermedia/` folder. [Editing these docs](./editing-these-docs.md) has its rules, its checks and when an edit is published.

# Reporting security issues <!-- id:bIIWptx2 -->

Report security issues by email to [security@hyper.media](mailto:security@hyper.media). Do not open a public issue or pull request about an unfixed vulnerability. This repository is public. <!-- id:c1G7qQ-T -->

See the repository's [security-audit skill](https://github.com/seed-hypermedia/seed/blob/main/.agents/skills/security-audit/SKILL.md) and [audit log](https://github.com/seed-hypermedia/seed/blob/main/.agents/skills/security-audit/resources/audit-log.md) for audit procedures and prior coverage. <!-- id:xbymaI9s -->

# See also <!-- id:-aDpNcBJ -->

- [The Seed software](../software.md), a map of every program in the repository. <!-- id:erSntcM2 -->
- [Getting started](../build/getting-started.md), for using Seed without changing it. <!-- id:h-8pj_T2 -->
- [Self-hosting](../operate/self-hosting.md), for running a site. <!-- id:A3x3u2MP -->
- [Working on Seed](../contribute.md), the list of contributor guides.
- [Development](./development.md), for the app environment in `apps/`.
- [Editing these docs](./editing-these-docs.md) and [Publish a folder](../build/publish-a-folder.md), for how these docs round-trip. <!-- id:hv5PxrzW -->
- [Daemon gRPC](../build/grpc.md), for the services the protobuf files define. <!-- id:ta6poGjk -->
