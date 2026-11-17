---
name: The Seed software
summary: A map of every program in the Seed repository, what each one is for, how it talks to the daemon, and which ports and directories it uses.
---
Seed is the open-source implementation of the [Hypermedia protocol](./protocol.md). It is a small family of programs: a [daemon](./software/daemon.md) that holds the data and talks to the [network](./protocol/network.md), apps that put a person in front of that daemon, services that add email, identity and [agents](./agent.md), and tools for scripting. This section has one page per program. Each page is a map for contributors and operators. It is not a user manual. <!-- id:gUOpqj79 -->

This section is about programs: software you install, run or deploy. It is not about an "app" in the product sense. An [app](./app.md) is a document that lists its [tools](./tool.md), [pages](./page.md) and [triggers](./trigger.md), and it has its own pages. The one place the two meet is the [app environment](./software/app-environment.md), the program that runs apps and [agents](./agent.md).

Everything lives in one repository, [github.com/seed-hypermedia/seed](https://github.com/seed-hypermedia/seed). The Go daemon and the protobuf definitions are built with Please and the `./dev` script. The TypeScript apps are a pnpm workspace under `frontend/`. The vault and the app environment are separate Bun workspaces. The mobile app manages its own dependencies with npm. [Contributing](./contribute/contributing.md) explains the setup. <!-- id:QnCwRvYQ -->

# The programs <!-- id:KycUesBu -->

Read [the daemon](./software/daemon.md) first, because every other program depends on one, directly or through a site. Then read the page of the program you work on.

<!-- id:mjIoKKzk -->
| Program <!-- col:HH5RAFlH --> | What it is <!-- col:wsZIACh8 --> | Where <!-- col:kLQrfXn9 --> | Talks to the daemon over <!-- col:RFDWKkfG --> <!-- id:h_RP8pxI --> |
| --- | --- | --- | --- |
| [Daemon](./software/daemon.md) | The Go node: storage, indexing, signing, libp2p [sync](./protocol/network.md), [gRPC](./build/grpc.md) and HTTP. | `backend/` | It is the daemon. <!-- id:JFJ4yZUc --> |
| [Desktop app](./software/desktop.md) | The Electron app: browser, editor, archive and a full peer. Spawns its own daemon and, when that setting is on, a local app environment. | `frontend/apps/desktop` | gRPC-web on the daemon's HTTP port. <!-- id:9TzkAsra --> |
| [Web app](./software/web.md) | The site server and gateway: server-rendered pages, the [Seed API](./build/web-api.md), site services, browser signing. | `frontend/apps/web` | gRPC-web on the daemon's HTTP port, with a per-request bearer token. <!-- id:uwYteixI --> |
| [CLI](./software/cli.md) | The command-line client for documents, comments, contacts, capabilities and keys, and the tool that publishes this folder. | `frontend/apps/cli` | The Seed API of a site over HTTPS; optionally a local daemon. <!-- id:DaFYsl_H --> |
| [Notify](./software/notify.md) | The notifications and email service. | `frontend/apps/notify` and `frontend/apps/emails` | The daemon's activity feed over gRPC-web. <!-- id:WQ3HmGIZ --> |
| [Vault](./software/vault.md) | The zero-knowledge identity vault that keeps account keys and delegates [session keys](./build/sign-in.md) to browsers. | `vault/` | gRPC-web to the site's daemon for account lookups and signing, and `/ipfs` uploads of [profile](./protocol/identity.md) and [capability](./protocol/permissions.md) blobs. <!-- id:3PPrdujc --> |
| [Mobile app](./software/mobile.md) | The Expo app for iOS, Android and web. | `frontend/apps/mobile` | The Seed API of a site. <!-- id:Dlw0ycZV --> |
| [Explorer](./software/explorer.md) | A raw-data browser for the network: [documents](./protocol/documents.md), [blobs](./protocol/blobs.md), feeds, an API lab. | `frontend/apps/explore` | The Seed API of a site. <!-- id:3eLF4nKi --> |
| [App environment](./software/app-environment.md) | The server that runs [agents](./agent.md) and [apps](./app.md): a signed action API, sessions, tools and [triggers](./trigger.md). | `apps/` | The Seed API, as a client with delegated keys. <!-- id:tD5uUn5J --> |

Every program page has the same sections: where the code is, how it talks to the daemon, configuration, running it, and working with it from the Seed app, the CLI, the SDK, the web API and agents.

# The shared packages <!-- id:evdyBAUd -->

Four TypeScript packages in `frontend/packages/` sit under the programs: `@seed-hypermedia/client` (the [SDK](./build/sdk.md)), `@shm/shared` (the app layer), `@shm/ui` (the components) and `@shm/editor` (the block editor). They depend on each other in that order. [The shared packages](./software/packages.md) describes each one, the editor, and the rules that make a document and an embed look the same in every program.

# Ports at a glance <!-- id:tPJXAO-z -->

<!-- id:wsCNRddS -->
| Port <!-- col:KNTceT2s --> | Prod <!-- col:DlHNg21J --> | Dev <!-- col:BLxizU3w --> | Belongs to <!-- col:GpzMIECV --> <!-- id:5_4zPEYb --> |
| --- | --- | --- | --- |
| Daemon P2P | 56000 | 58000 | daemon, spawned by the desktop app <!-- id:meqnTMHt --> |
| Daemon HTTP, gRPC-web, `/ipfs`, `/debug` | 56001 | 58001 | daemon <!-- id:ee6KDn6V --> |
| Daemon native gRPC | 56002 | 58002 | daemon, unused by the TypeScript apps <!-- id:So3JimZb --> |
| Daemon metrics | 56003 | 58003 | daemon <!-- id:KJp_L1eE --> |
| Desktop API bridge, `/api/*` | 56004 | 58004 | desktop app <!-- id:xh4k7Zhf --> |
| App environment | 3050 | 3051 | app environment <!-- id:RGYFw4bQ --> |
| Vault |  | 3030 | vault <!-- id:0VCPAXei --> |
| Web app |  | 3000 | web <!-- id:CpVjVDrJ --> |
| Notify |  | 3060 | notify <!-- id:I6y43K8- --> |
| Explorer |  | 5173 | explore <!-- id:WWefOI4y --> |

This is the one port table of the site; the program pages link here. "Prod" is a released desktop app and "Dev" is the development stack that `./dev up` starts, so the two can run side by side. A daemon started on its own, without the desktop app, defaults to 55000, 55001 and 55002. Hosted [sites](./protocol/sites.md) run their daemon on 56000 behind a reverse proxy. Outside development, notify and the vault listen on 3000 by default; each program page names its port setting. <!-- id:MvKg_GX3 -->

# See also <!-- id:OZLxqZdp -->

- [The shared packages](./software/packages.md), the code the programs have in common.
- [App](./app.md), [Tool](./tool.md), [Page](./page.md) and [Trigger](./trigger.md), the product concepts that are documents, not programs.
- [Seed Agents](./agent.md), what the app environment runs. <!-- id:rXMWvQ23 -->
- [Building on Hypermedia](./build.md), for using these programs from your own code. <!-- id:c6L_X3Dv -->
- [The web API](./build/web-api.md), the Seed API most of these programs speak. <!-- id:ASzcRpeV -->
- [Running Seed](./operate.md) and [Self-hosting](./operate/self-hosting.md), for running a site. <!-- id:dhRFEU6- -->
- [Contributing](./contribute/contributing.md), for developing them. <!-- id:6S0cZ3WH -->
- [The protocol](./protocol.md), what the daemon implements. <!-- id:zIQ4sfQN -->

# The programs, one page each <!-- id:YUgKiUa5 attrs:{"childrenType":"Grid","columnCount":3} -->

<./software/daemon.md> <!-- id:4aysBe2u type:Embed attrs:{"view":"Card"} -->

<./software/desktop.md> <!-- id:MacRaRqz type:Embed attrs:{"view":"Card"} -->

<./software/web.md> <!-- id:k2FGfnXS type:Embed attrs:{"view":"Card"} -->

<./software/cli.md> <!-- id:RtD9o77C type:Embed attrs:{"view":"Card"} -->

<./software/notify.md> <!-- id:9aKBTeji type:Embed attrs:{"view":"Card"} -->

<./software/vault.md> <!-- id:EphtkFYe type:Embed attrs:{"view":"Card"} -->

<./software/mobile.md> <!-- id:C3TTrGji type:Embed attrs:{"view":"Card"} -->

<./software/explorer.md> <!-- id:SDOytJ5w type:Embed attrs:{"view":"Card"} -->

<./software/app-environment.md> <!-- id:Qo1lEcy8 type:Embed attrs:{"view":"Card"} -->

<./software/packages.md> <!-- id:vALudYvo type:Embed attrs:{"view":"Card"} -->
