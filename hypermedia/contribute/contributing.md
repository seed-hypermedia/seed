---
name: Contributing
summary: This page shows how to find your way around the Seed repository, set it up, run the development stack, run the checks for each part, and make the changes that have special rules.
---
Seed is one public repository, [github.com/seed-hypermedia/seed](https://github.com/seed-hypermedia/seed). This page is for people who want to change anything in it. Read it first: it gets the code running on your machine. <!-- id:_zvH8SHk -->

The repository holds the [Go daemon](../software/daemon.md), the TypeScript apps and libraries, the [app environment](../software/app-environment.md) that runs [Seed Agents](../agent.md), the [vault](../software/vault.md), the deployment tools, and the markdown for this [site](../protocol/sites.md).

This page covers four things:

- The layout of the repository.
- The development stack, which one command starts.
- The checks to run for each area before a pull request.
- The rules for changes that are hard to undo: storage migrations and protocol changes.

[Working on Seed](../contribute.md) lists the other guides for contributors.

The repository keeps instructions for coding agents in `AGENTS.md` at the root and in the folders listed below. They are written for people too. Where this page and an `AGENTS.md` file differ, the `AGENTS.md` file is right. <!-- id:vX8_MKKR -->

# The repository <!-- id:ml67ascN -->

<!-- id:qkA7gG_e -->
| Path <!-- col:iWguLxEY --> | What lives there <!-- col:x03VL8Ja --> | Toolchain <!-- col:YTGiImZw --> <!-- id:-Wd8HBYw --> |
| --- | --- | --- |
| `backend/` | the Seed daemon: storage and indexing (`storage/`, `blob/`), the document model and CRDTs (`api/documents/`, `crdt/`), networking (`hmnet/`), gRPC APIs (`api/`), the embedding model (`llm/`) | Go, built with Please <!-- id:H2EwgJQj --> |
| `proto/` | protobuf definitions for every daemon service; generated Go and TypeScript are checked in | Please, `./dev gen` <!-- id:0NSWiC7J --> |
| `frontend/apps/desktop` | the [Seed app](../software/desktop.md) (Electron) | pnpm <!-- id:Zbe5Pvw9 --> |
| `frontend/apps/web` | the [Seed web app](../software/web.md) that serves sites, the [Seed API](../build/web-api.md) and the [site services](../build/site-services.md) (Remix) | pnpm <!-- id:0CIOxjFE --> |
| `frontend/apps/cli` | `seed-cli`, also the home of the `hypermedia/` sync script | pnpm workspace, runs under Bun <!-- id:2PI-xaLm --> |
| `frontend/apps/notify` | the email [notification service](../software/notify.md) | pnpm <!-- id:1XZADdbO --> |
| `frontend/apps/explore` | the [Hypermedia Explorer](../software/explorer.md) | pnpm <!-- id:jIim84ro --> |
| `frontend/apps/mobile` | the [React Native app](../software/mobile.md), outside the pnpm workspace | npm <!-- id:RqovKZdX --> |
| `frontend/apps/landing`, `emails`, `perf-web`, `performance`, `performance-dashboard` | the landing site, email templates, performance tooling | pnpm <!-- id:-PiCtbX7 --> |
| `frontend/packages/client` | `@seed-hypermedia/client`, the [published SDK](../build/sdk.md) | pnpm <!-- id:8NqjCj-r --> |
| `frontend/packages/shared`, `ui`, `editor`, `apps-ui` | shared models and hooks (`@shm/shared`), UI components (`@shm/ui`), the editor (`@shm/editor`), the packaged agents screens (`@seed-hypermedia/apps-ui`); see [The shared packages](../software/packages.md) | pnpm <!-- id:cUHLxKb5 --> |
| `apps/` | the app environment, the server that runs Seed Agents; see [Development](./development.md) | its own Bun workspace <!-- id:qOYduI_0 --> |
| `vault/` | the [key vault service](../software/vault.md) | its own Bun workspace <!-- id:7uVXnFiT --> |
| `hypermedia/` | this site: concept pages, the [Hypermedia Schemas](../schema.md) library, the references and guides; see [Editing these docs](./editing-these-docs.md) | markdown, `scripts/hypermedia/` <!-- id:KGtdocvh --> |
| `ops/` | the [self-hosted node](../operate/self-hosting.md) deployment script (`seed-deploy`) | pinned Bun <!-- id:sKjHiyy5 --> |
| `tests/` | cross-app integration tests | pnpm, Vitest, Playwright <!-- id:jLogi_RO --> |
| `docs/` | internal design notes, decision records, runbooks and the security audit log; not published | markdown <!-- id:SH8-ft4T --> |

`apps/` and `vault/` copy the frontend packages they use through `file:` dependencies. So a change to `frontend/packages/*` reaches them only after `bun install`. Their development servers do this for you. The map pages under [The Seed software](../software.md), such as [Daemon](../software/daemon.md), [Desktop](../software/desktop.md) and [Web](../software/web.md), explain how the programs talk to each other. <!-- id:qypHor4G -->

# Setting up <!-- id:mePBDhAD -->

`mise.toml` fixes the version of every tool, and `direnv` turns them on in your shell. <!-- id:kSqWFI66 -->

1. Install [mise](https://mise.jdx.dev) and [direnv](https://direnv.net), and hook direnv into your shell.
2. Clone the repository and allow the environment, with the commands below.

The first `direnv allow` takes a few minutes. It installs the tools, sets up the `llama-go` submodule, downloads the embedding model that the daemon uses for search, and builds the llama.cpp libraries. <!-- id:UzZJf2g1 -->

```sh <!-- id:sDnks94Q -->
git clone https://github.com/seed-hypermedia/seed
cd seed
direnv allow
pnpm install
```

Install Docker too if you want the full stack. The web search backends that agents use run as containers. <!-- id:hd08Yp6V -->

`./dev` only runs in a shell where direnv is active. From a script or a coding agent, run commands as `direnv exec . <command>`. <!-- id:nj4bpkxj -->

# Running things <!-- id:FRDrDXTI -->

`./dev` with no arguments lists every command. These are the ones you will use: <!-- id:v-FeFPO8 -->

<!-- id:pDvelppf -->
| Command <!-- col:nKJRfTtJ --> | What it does <!-- col:jCwY3jCK --> <!-- id:wxmUSi_O --> |
| --- | --- |
| `./dev up` | the whole stack on mainnet in one mprocs window, one pane per process (see `mprocs.yaml`) <!-- id:mNYXdjtH --> |
| `./dev up-testnet` | the same stack on the dev testnet (see `mprocs.testnet.yaml`) <!-- id:nWiElzcx --> |
| `./dev run-desktop` | build the daemon, then run the desktop app on the dev testnet; the app starts its own daemon <!-- id:fYOpAbIh --> |
| `./dev run-desktop-mainnet` | the same, on mainnet <!-- id:IIoKH2Cu --> |
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
| `host` | the hosting service; it runs only when a SeedHost checkout sits beside this repository | :5555 |
| `hm-sync` | the round trip between `hypermedia/` and the desktop app | <!-- id:glFq6Sx0 --> |

In mprocs, `r` restarts the selected process, `s` stops it, `x` starts it and `q` quits everything. Quitting also runs `docker compose down` for the search containers. The development daemon and the desktop app use ports 58000 to 58004. The full port table is on [The Seed software](../software.md#ports-at-a-glance). <!-- id:yNq5NmzQ -->

Scripts in the root `package.json` start one app each: `pnpm web`, `pnpm desktop`, `pnpm notify`, `pnpm explore` and `pnpm mobile`. `pnpm web:standalone` runs a web app with its own daemon. <!-- id:rgUFvjTw -->

# Checks before a pull request <!-- id:vQX0hVxi -->

Run the checks for every area you changed. CI runs the same ones. One file with wrong formatting, anywhere, fails the `Lint` job. <!-- id:BDwIhXDx -->

<!-- id:vS3rWxCo -->
| Area <!-- col:-MvRpZjz --> | Commands <!-- col:I-M5rtMN --> <!-- id:uRsCX3t0 --> |
| --- | --- |
| Whole TypeScript workspace | `pnpm typecheck` <!-- id:d94Q1u3R --> |
| Formatting, everywhere | `pnpm format:write`, then `pnpm format:check` from the root; this covers the pnpm workspace, `apps/` and `vault/` <!-- id:mph0fqf0 --> |
| Web, shared, desktop unit tests | `pnpm test` runs all three; singly `pnpm web:test`, `pnpm shared:test`, `pnpm desktop:test:unit` <!-- id:dugjfXvL --> |
| [SDK](../build/sdk.md), UI, editor, notify, explore | `pnpm --filter @seed-hypermedia/client test`, `pnpm --filter @shm/ui test`, `pnpm --filter @shm/editor test`, and the same for `@shm/notify` and `@shm/explore` <!-- id:ofZFP1b2 --> |
| [CLI](../software/cli.md) | `pnpm --filter @seed-hypermedia/cli test` (a fixture suite against a real daemon) and `pnpm --filter @seed-hypermedia/cli test:unit` <!-- id:VOFZaWCk --> |
| Desktop end to end | `pnpm desktop:test`, which packages the app and drives it with Playwright <!-- id:Gilwz1nW --> |
| Integration | `pnpm test:integration` from the root <!-- id:x7ufnsyK --> |
| Mobile | `pnpm mobile:test`, `pnpm mobile:typecheck` <!-- id:d-fTb5LC --> |
| App environment | `bun check` and `bun test` in `apps/`; `bun run protocol:check` when you change the protocol between the server and its clients <!-- id:8k_Msi6q --> |
| Vault | `bun check` and `bun test` in `vault/` <!-- id:fxNXvKas --> |
| Dependencies | `pnpm audit --audit-level=high --ignore-registry-errors`, the command the `Security Audit` workflow runs <!-- id:3GkKdSas --> |
| Go | `go test ./backend/...` and `golangci-lint run --new-from-merge-base origin/main ./backend/...` <!-- id:y8N1xXkq --> |
| Docs | `node scripts/hypermedia/check.mjs`; see [Editing these docs](./editing-these-docs.md) <!-- id:n7uUGSnA --> |

Three notes on these checks: <!-- id:Fo7jkVlG -->

- In `apps/` and `vault/`, `bun check` runs the type checker and fixes the formatting. Commit whatever it changes.
- The Go tests need the submodule and the model that `direnv allow` fetched. CI runs them with `go test -tags cpu --count 1 ./backend/...`.
- For a bug fix in the backend, first add a test that fails, when you can. Use `testify/require` in Go tests.

To run CI on your machine before you push, use [agent-ci](https://agent-ci.dev). [Local CI with agent-ci](./local-ci.md) has the setup and the command for each area. <!-- id:eVnAHnXe -->

# Changes with special rules <!-- id:kg5ajun_ -->

## Storage schema and migrations <!-- id:9X3SrtbM -->

The daemon's SQLite schema is in `backend/storage/schema.sql`, which is the source of truth. The migrations are in `backend/storage/storage_migrations.go`. Read the note at the top of that file before you add one. These are the rules it sets: <!-- id:PBuNzSFX -->
  - The version of a migration is a timestamp from `date +%Y-%m-%d.%H%M%S`. The list is kept with the newest first. <!-- id:QnRf8-hL -->
  - The run function of a migration runs in an immediate write transaction. Write it so that running it twice does no harm, as far as you can. <!-- id:dMdOoxSo -->
  - A migration runs only when its version is higher than the version of the data directory. So never run a feature branch that has a migration against a data directory you care about. Back the directory up first. If you switch back to main afterwards, the daemon fails on the unknown version. <!-- id:8uBgJSVC -->
  - After you change the schema or the migrations, run `./dev gen //backend/...`. <!-- id:7oHp9y6v -->
  - Avoid a migration that forces a full reindex or computes the embeddings again, unless you must. Servers without a GPU take a long time to do that. Prefer a new column and a background task that fills it in small steps. <!-- id:EJFyB_7G -->

If you are not sure, ask the backend team before you add a migration. Tag the maintainers of the Go daemon on pull requests that change `backend/`. <!-- id:1RS6C3Xu -->

## Protobuf and generated code <!-- id:Pl9dV8uc -->

Edit the `.proto` files under `proto/`, then run `./dev gen //proto/...` from the root. Do not run `buf` or `protoc` yourself, and do not format the generated code. A proto change reaches both Go and TypeScript callers, so run the backend checks and the frontend checks above. [gRPC](../build/grpc.md) describes the services for people who call them. <!-- id:elbsSmmW -->

## Protocol changes <!-- id:Db7n9S4a -->

A protocol change is a change to something that every implementation must agree on: <!-- id:tPvbLW30 -->

- The structure or the meaning of permanent data: [blobs](../protocol/blobs.md), [changes](../change.md), the graph of changes that makes a [document](../protocol/documents.md), and the rules that merge edits.
- The [sync protocol](../protocol/network.md).
- The [capability model](../protocol/permissions.md).
- The [identity system](../protocol/identity.md).
- Any format that another implementation must read on disk or over the network.

A feature that you can build in an application alone is not a protocol change. The team's advice is to build it that way first.

This is the team's process for a protocol change: <!-- id:xe8WbGn1 -->
  1. Write a proposal note that describes the problem and the change. <!-- id:f0kCZNVa -->
  2. Write down the arguments for and against it in the open. Include the options you rejected. <!-- id:VImOJ8CK -->
  3. Decide by working through the technical objections. A vote does not decide. <!-- id:o-O2bJml -->
  4. Update the protocol documentation on this site. <!-- id:YiDYgKHv -->

The process is slow on purpose, because published blobs are permanent. Every node that holds old data must still be able to read it. <!-- id:-hDpm579 -->

## Deployment tooling <!-- id:v7shYIEe -->

`ops/` is built with the exact Bun version named in `ops/package.json`. CI fails if `ops/dist/deploy.js` does not match the source. When you change the deploy script, build it again with that version, as `bunx --bun bun@<version> build …`. <!-- id:C8p8sJ_w -->

# Releasing and publishing <!-- id:1K6l12Qg -->

Maintainers make releases with the steps in [Releasing](./releasing.md). GitHub Actions publishes the npm packages, as [Package publishing](./package-publishing.md) explains. [Sentry](./sentry.md) covers error reporting. <!-- id:NpvcWh0F -->

This site is the `hypermedia/` folder. [Editing these docs](./editing-these-docs.md) has its rules, its checks and when an edit is published.

# Reporting security issues <!-- id:bIIWptx2 -->

Report a security issue by email to [security@hyper.media](mailto:security@hyper.media). This repository is public. So do not open a public issue or pull request about a vulnerability that is not fixed. <!-- id:c1G7qQ-T -->

The repository's [security-audit skill](https://github.com/seed-hypermedia/seed/blob/main/.agents/skills/security-audit/SKILL.md) describes how audits are done, and its [audit log](https://github.com/seed-hypermedia/seed/blob/main/.agents/skills/security-audit/resources/audit-log.md) lists what earlier audits covered. <!-- id:xbymaI9s -->

# See also <!-- id:-aDpNcBJ -->

- [The Seed software](../software.md), a map of every program in the repository. <!-- id:erSntcM2 -->
- [Getting started](../build/getting-started.md), for using Seed without changing it. <!-- id:h-8pj_T2 -->
- [Self-hosting](../operate/self-hosting.md), for running a site. <!-- id:A3x3u2MP -->
- [Working on Seed](../contribute.md), the list of contributor guides.
- [Development](./development.md), for the app environment in `apps/`.
- [Editing these docs](./editing-these-docs.md) and [Publish a folder](../build/publish-a-folder.md), for how these docs round-trip. <!-- id:hv5PxrzW -->
- [Daemon gRPC](../build/grpc.md), for the services the protobuf files define. <!-- id:ta6poGjk -->
