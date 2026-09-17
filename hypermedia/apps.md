---
name: The Seed software
summary: A map of every program in the Seed repository, what each one is for, how it talks to the daemon, and which ports and directories it uses.
---
Seed is the open-source implementation of the Hypermedia protocol. It is not one program but a small family: a daemon that holds the data and talks to the network, apps that put a person in front of that daemon, services that add email, identity and agents, and tools for scripting. This section has one page per program, each a map for contributors and operators rather than a manual.

Everything lives in one repository, [github.com/seed-hypermedia/seed](https://github.com/seed-hypermedia/seed). The Go daemon and the protobuf definitions are built with Please and the `./dev` script; the TypeScript apps are a pnpm workspace under `frontend/`; the vault and the agents service are separate Bun workspaces; the mobile app manages its own dependencies with npm. [Contributing](./build/contributing.md) explains the setup.

# The programs

| Program | What it is | Where | Talks to the daemon over |
| --- | --- | --- | --- |
| [Daemon](./apps/daemon.md) | The Go node: storage, indexing, signing, libp2p sync, gRPC and HTTP. | `backend/` | It is the daemon. |
| [Desktop app](./apps/desktop.md) | The Electron app: browser, editor, archive and a full peer. Spawns its own daemon and a local agents server. | `frontend/apps/desktop` | gRPC-web on the daemon's HTTP port. |
| [Web app](./apps/web.md) | The site server and gateway: server-rendered pages, the Seed API, site services, browser signing. | `frontend/apps/web` | gRPC-web on the daemon's HTTP port, with a per-request bearer token. |
| [CLI](./apps/cli.md) | The command-line client for documents, comments, contacts, capabilities and keys, and the tool that publishes this folder. | `frontend/apps/cli` | The Seed API of a site over HTTPS; optionally a local daemon. |
| [Notify](./apps/notify.md) | The notifications and email service. | `frontend/apps/notify` and `frontend/apps/emails` | The daemon's activity feed over gRPC-web. |
| [Vault](./apps/vault.md) | The zero-knowledge identity vault that keeps account keys and delegates session keys to browsers. | `vault/` | gRPC-web to the site's daemon for account lookups and signing, and `/ipfs` uploads of profile and capability blobs. |
| [Mobile app](./apps/mobile.md) | The Expo app for iOS, Android and web. | `frontend/apps/mobile` | The Seed API of a site. |
| [Explorer](./apps/explorer.md) | A raw-data browser for the network: documents, blobs, feeds, an API lab. | `frontend/apps/explore` | The Seed API of a site. |
| [Seed Agents](./apps/agents.md) | The agent runtime: a signed action API, sessions, tools and triggers. | `agents/` | The Seed API, as a client with delegated keys. |

# The shared packages

Four TypeScript packages sit under the apps, in `frontend/packages/`.

- **`@seed-hypermedia/client`**, the SDK. Framework-free and published to npm: Hypermedia ids and types, blob creation and signing, CBOR, the HTTP client for the Seed API, markdown conversion, the query grammar, key files and vault helpers, and the Hypermedia Schemas engine. Consumed by every app, by the CLI, by the vault and by the agents service. See [The SDK](./build/sdk.md).
- **`@shm/shared`**, the app layer: generated gRPC clients, the typed API router and its HTTP server adapter, the universal client abstraction, React Query models, routes and translations. Not published.
- **`@shm/ui`**, the React component library, page components, and the shared agents client and models used by desktop, web and mobile.
- **`@shm/editor`**, the block editor, a BlockNote fork on TipTap and ProseMirror, with a server-side renderer.

The dependency direction is client, then shared, then ui, then editor. The vault and the agents service consume `client` and `shared` through Bun `file:` dependencies, which copy the packages at install time; a watcher script reinstalls them during development.

# Ports at a glance

| Port | Prod | Dev | Belongs to |
| --- | --- | --- | --- |
| Daemon P2P | 56000 | 58000 | daemon, spawned by the desktop app |
| Daemon HTTP, gRPC-web, `/ipfs`, `/debug` | 56001 | 58001 | daemon |
| Daemon native gRPC | 56002 | 58002 | daemon, unused by the TypeScript apps |
| Daemon metrics | 56003 | 58003 | daemon |
| Desktop API bridge, `/api/*` | 56004 | 58004 | desktop app |
| Agents server | 3050 | 3051 | agents |
| Vault | | 3030 | vault |
| Web app | | 3000 | web |
| Notify | | 3060 | notify |
| Explorer | | 5173 | explore |

A daemon started on its own, without the desktop app, defaults to 55000, 55001 and 55002. Hosted sites run their daemon on 56000 behind a reverse proxy.

# See also

- [Building on Hypermedia](./build.md), for using these programs from your own code.
- [Self-hosting](./build/self-hosting.md), for running a site.
- [Contributing](./build/contributing.md), for developing them.
