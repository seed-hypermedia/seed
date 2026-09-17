---
name: The Seed software
summary: A map of every program in the Seed repository, what each one is for, how it talks to the daemon, and which ports and directories it uses.
---
Seed is the open-source implementation of the Hypermedia protocol. It is not one program but a small family: a daemon that holds the data and talks to the network, apps that put a person in front of that daemon, services that add email, identity and agents, and tools for scripting. This section has one page per program, each a map for contributors and operators rather than a manual. <!-- id:gUOpqj79 -->

Everything lives in one repository, [github.com/seed-hypermedia/seed](https://github.com/seed-hypermedia/seed). The Go daemon and the protobuf definitions are built with Please and the `./dev` script; the TypeScript apps are a pnpm workspace under `frontend/`; the vault and the agents service are separate Bun workspaces; the mobile app manages its own dependencies with npm. [Contributing](./build/contributing.md) explains the setup. <!-- id:QnCwRvYQ -->

# The programs <!-- id:KycUesBu -->

<!-- id:mjIoKKzk -->
| Program <!-- col:HH5RAFlH --> | What it is <!-- col:wsZIACh8 --> | Where <!-- col:kLQrfXn9 --> | Talks to the daemon over <!-- col:RFDWKkfG --> <!-- id:h_RP8pxI --> |
| --- | --- | --- | --- |
| [Daemon](./apps/daemon.md) | The Go node: storage, indexing, signing, libp2p sync, gRPC and HTTP. | `backend/` | It is the daemon. <!-- id:JFJ4yZUc --> |
| [Desktop app](./apps/desktop.md) | The Electron app: browser, editor, archive and a full peer. Spawns its own daemon and a local agents server. | `frontend/apps/desktop` | gRPC-web on the daemon's HTTP port. <!-- id:9TzkAsra --> |
| [Web app](./apps/web.md) | The site server and gateway: server-rendered pages, the Seed API, site services, browser signing. | `frontend/apps/web` | gRPC-web on the daemon's HTTP port, with a per-request bearer token. <!-- id:uwYteixI --> |
| [CLI](./apps/cli.md) | The command-line client for documents, comments, contacts, capabilities and keys, and the tool that publishes this folder. | `frontend/apps/cli` | The Seed API of a site over HTTPS; optionally a local daemon. <!-- id:DaFYsl_H --> |
| [Notify](./apps/notify.md) | The notifications and email service. | `frontend/apps/notify` and `frontend/apps/emails` | The daemon's activity feed over gRPC-web. <!-- id:WQ3HmGIZ --> |
| [Vault](./apps/vault.md) | The zero-knowledge identity vault that keeps account keys and delegates session keys to browsers. | `vault/` | gRPC-web to the site's daemon for account lookups and signing, and `/ipfs` uploads of profile and capability blobs. <!-- id:3PPrdujc --> |
| [Mobile app](./apps/mobile.md) | The Expo app for iOS, Android and web. | `frontend/apps/mobile` | The Seed API of a site. <!-- id:Dlw0ycZV --> |
| [Explorer](./apps/explorer.md) | A raw-data browser for the network: documents, blobs, feeds, an API lab. | `frontend/apps/explore` | The Seed API of a site. <!-- id:3eLF4nKi --> |
| [Seed Agents](./apps/agents.md) | The agent runtime: a signed action API, sessions, tools and triggers. | `agents/` | The Seed API, as a client with delegated keys. <!-- id:tD5uUn5J --> |

# The shared packages <!-- id:evdyBAUd -->

Four TypeScript packages sit under the apps, in `frontend/packages/`. <!-- id:VuzMO9aA -->
  - **`@seed-hypermedia/client`**, the SDK. Framework-free and published to npm: Hypermedia ids and types, blob creation and signing, CBOR, the HTTP client for the Seed API, markdown conversion, the query grammar, key files and vault helpers, and the Hypermedia Schemas engine. Consumed by every app, by the CLI, by the vault and by the agents service. See [The SDK](./build/sdk.md). <!-- id:af1iM0fw -->
  - **`@shm/shared`**, the app layer: generated gRPC clients, the typed API router and its HTTP server adapter, the universal client abstraction, React Query models, routes and translations. Not published. <!-- id:9VA3j7ZM -->
  - **`@shm/ui`**, the React component library, page components, and the shared agents client and models used by desktop, web and mobile. <!-- id:IH_t_sTd -->
  - **`@shm/editor`**, the block editor, a BlockNote fork on TipTap and ProseMirror, with a server-side renderer. <!-- id:Zr-SLVsN -->

The dependency direction is client, then shared, then ui, then editor. The vault and the agents service consume `client` and `shared` through Bun `file:` dependencies, which copy the packages at install time; a watcher script reinstalls them during development. <!-- id:YLWb2fg1 -->

# Ports at a glance <!-- id:tPJXAO-z -->

<!-- id:wsCNRddS -->
| Port <!-- col:KNTceT2s --> | Prod <!-- col:DlHNg21J --> | Dev <!-- col:BLxizU3w --> | Belongs to <!-- col:GpzMIECV --> <!-- id:5_4zPEYb --> |
| --- | --- | --- | --- |
| Daemon P2P | 56000 | 58000 | daemon, spawned by the desktop app <!-- id:meqnTMHt --> |
| Daemon HTTP, gRPC-web, `/ipfs`, `/debug` | 56001 | 58001 | daemon <!-- id:ee6KDn6V --> |
| Daemon native gRPC | 56002 | 58002 | daemon, unused by the TypeScript apps <!-- id:So3JimZb --> |
| Daemon metrics | 56003 | 58003 | daemon <!-- id:KJp_L1eE --> |
| Desktop API bridge, `/api/*` | 56004 | 58004 | desktop app <!-- id:xh4k7Zhf --> |
| Agents server | 3050 | 3051 | agents <!-- id:RGYFw4bQ --> |
| Vault |  | 3030 | vault <!-- id:0VCPAXei --> |
| Web app |  | 3000 | web <!-- id:CpVjVDrJ --> |
| Notify |  | 3060 | notify <!-- id:I6y43K8- --> |
| Explorer |  | 5173 | explore <!-- id:WWefOI4y --> |

A daemon started on its own, without the desktop app, defaults to 55000, 55001 and 55002. Hosted sites run their daemon on 56000 behind a reverse proxy. <!-- id:MvKg_GX3 -->

# See also <!-- id:OZLxqZdp -->

- [Building on Hypermedia](./build.md), for using these programs from your own code. <!-- id:c6L_X3Dv -->
- [Self-hosting](./build/self-hosting.md), for running a site. <!-- id:dhRFEU6- -->
- [Contributing](./build/contributing.md), for developing them. <!-- id:6S0cZ3WH -->
