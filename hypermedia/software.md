---
name: The Seed software
summary: This section maps every program in the Seed repository and says what each one is for, where its code is, how it reaches the daemon, and which port it uses.
---
Seed is the open-source software for the [Hypermedia protocol](./protocol.md). It is a small family of programs that work together, and this section has one page for each program. Each page is a map for people who change or run that program. It is not a user manual. <!-- id:gUOpqj79 -->

The programs fall into four groups:

- The [daemon](./software/daemon.md) holds the data and talks to the [network](./protocol/network.md). Every other program depends on one.
- The apps put a person in front of a daemon: the [desktop app](./software/desktop.md), the [web app](./software/web.md) and the [mobile app](./software/mobile.md).
- The services add things around it: [notify](./software/notify.md) sends email, the [vault](./software/vault.md) keeps identities, and the [app environment](./software/app-environment.md) runs [agents](./agent.md).
- The tools are for scripts and for looking at data: the [CLI](./software/cli.md) and the [Explorer](./software/explorer.md).

A program here means software you install, run or deploy. It does not mean an "app" in the product sense. An [app](./app.md) is a document that lists its [tools](./tool.md), [pages](./page.md) and [triggers](./trigger.md), and it has its own pages on this site. The two meet in one place: the [app environment](./software/app-environment.md) is the program that runs apps and agents.

All the code is in one repository, [github.com/seed-hypermedia/seed](https://github.com/seed-hypermedia/seed). It uses four toolchains: <!-- id:QnCwRvYQ -->

- The Go daemon and the protobuf definitions are built with Please and the `./dev` script.
- The TypeScript apps are a pnpm workspace under `frontend/`.
- The vault and the app environment are separate Bun workspaces.
- The mobile app installs its own dependencies with npm.

[Contributing](./contribute/contributing.md) explains the setup.

# The programs <!-- id:KycUesBu -->

Read [the daemon](./software/daemon.md) first, because every other program needs one, directly or through a [site](./protocol/sites.md). Then read the page of the program you work on.

<!-- id:mjIoKKzk -->
| Program <!-- col:HH5RAFlH --> | What it is <!-- col:wsZIACh8 --> | Where <!-- col:kLQrfXn9 --> | Talks to the daemon over <!-- col:RFDWKkfG --> <!-- id:h_RP8pxI --> |
| --- | --- | --- | --- |
| [Daemon](./software/daemon.md) | The Go node. It stores, indexes and signs data, [syncs](./protocol/network.md) over libp2p, and serves [gRPC](./build/grpc.md) and HTTP. | `backend/` | It is the daemon. <!-- id:JFJ4yZUc --> |
| [Desktop app](./software/desktop.md) | The Electron app: a browser, an editor and an archive. It starts its own daemon and, unless that setting is off, a local app environment that runs tools. | `frontend/apps/desktop` | gRPC-web on the daemon's HTTP port. <!-- id:9TzkAsra --> |
| [Web app](./software/web.md) | The site server and gateway. It serves rendered pages, the [Seed API](./build/web-api.md) and the [site services](./build/site-services.md), and it signs in the browser. | `frontend/apps/web` | gRPC-web on the daemon's HTTP port, with a [bearer token](./protocol/identity.md#proving-identity-to-a-server) for each request. <!-- id:uwYteixI --> |
| [CLI](./software/cli.md) | The command-line client for [documents](./protocol/documents.md), [comments](./protocol/comments.md), [contacts](./protocol/contacts.md), [capabilities](./protocol/permissions.md) and keys. It also publishes these docs from git (see [Publish a folder](./build/publish-a-folder.md)). | `frontend/apps/cli` | The Seed API of a site over HTTPS. One command talks to a local daemon. <!-- id:DaFYsl_H --> |
| [Notify](./software/notify.md) | The notifications and email service. | `frontend/apps/notify` and `frontend/apps/emails` | The daemon's activity feed over gRPC-web. <!-- id:WQ3HmGIZ --> |
| [Vault](./software/vault.md) | The identity vault. It keeps [account](./protocol/identity.md) keys that the server cannot read, and it gives browsers [session keys](./build/sign-in.md). | `vault/` | gRPC-web to the site's daemon, to look up accounts and to sign. It uploads [profile](./profile.md) and [capability](./capability.md) [blobs](./protocol/blobs.md) to `/ipfs`. <!-- id:3PPrdujc --> |
| [Mobile app](./software/mobile.md) | The Expo app for iOS, Android and the web. | `frontend/apps/mobile` | The Seed API of a site. <!-- id:Dlw0ycZV --> |
| [Explorer](./software/explorer.md) | A browser for the raw data on the network: documents, blobs, the activity feed and an API lab. | `frontend/apps/explore` | The Seed API of a site. <!-- id:3eLF4nKi --> |
| [App environment](./software/app-environment.md) | The server that runs [agents](./agent.md) and [apps](./app.md). It has a [signed action API](./build/signed-api.md), sessions, tools and [triggers](./trigger.md). | `apps/` | The Seed API of a site, as a client with delegated keys. <!-- id:tD5uUn5J --> |

Every program page has the same sections: what the program is, where the code is, how it talks to the daemon, its configuration, how to run it, and how it works with the Seed app, the [CLI commands](./build/cli.md), the [SDK](./build/sdk.md), the Seed API and agents.

# The shared packages <!-- id:evdyBAUd -->

Five TypeScript packages in `frontend/packages/` sit under the programs:

- `@seed-hypermedia/client` is the SDK.
- `@shm/shared` is the app layer.
- `@shm/ui` holds the components.
- `@shm/editor` is the [block](./protocol/blocks.md) editor.
- `@seed-hypermedia/apps-ui` packages the agents screens for other apps.

The first four depend on each other in that order. [The shared packages](./software/packages.md) describes each one, the editor, and the rules that make a document look the same in every program.

# Ports at a glance <!-- id:tPJXAO-z -->

This is the port table of the site. The program pages link here.

<!-- id:wsCNRddS -->
| Port <!-- col:KNTceT2s --> | Prod <!-- col:DlHNg21J --> | Dev <!-- col:BLxizU3w --> | Belongs to <!-- col:GpzMIECV --> <!-- id:5_4zPEYb --> |
| --- | --- | --- | --- |
| Daemon P2P | 56000 | 58000 | daemon, spawned by the desktop app <!-- id:meqnTMHt --> |
| Daemon HTTP, gRPC-web, `/ipfs`, `/debug` | 56001 | 58001 | daemon <!-- id:ee6KDn6V --> |
| Daemon native gRPC | 56002 | 58002 | daemon, unused by the TypeScript apps <!-- id:So3JimZb --> |
| Desktop API bridge, `/api/*` | 56004 | 58004 | desktop app <!-- id:xh4k7Zhf --> |
| App environment | 3050 | 3051 | app environment <!-- id:RGYFw4bQ --> |
| Vault |  | 3030 | vault <!-- id:0VCPAXei --> |
| Web app |  | 3000 | web <!-- id:CpVjVDrJ --> |
| Notify |  | 3060 | notify <!-- id:I6y43K8- --> |
| Explorer |  | 5173 | explore <!-- id:WWefOI4y --> |

How to read the table: <!-- id:MvKg_GX3 -->

- "Prod" is a released desktop app. "Dev" is the development stack that `./dev up` starts. The two use different ports, so both can run at the same time.
- A daemon that you start yourself, without the desktop app, uses 55000, 55001 and 55002.
- A hosted site runs its daemon on 56000 behind a reverse proxy.
- Outside development, notify and the vault listen on 3000. Each program page names its port setting.
- The daemon has no separate metrics port. Its metrics are at `/debug/metrics` on the HTTP port.

The [daemon network reference](./operate/daemon-network.md) describes the daemon's ports in more detail.

# See also <!-- id:OZLxqZdp -->

- [The shared packages](./software/packages.md), the code the programs have in common.
- [App](./app.md), [Tool](./tool.md), [Page](./page.md) and [Trigger](./trigger.md), the product concepts that are documents, not programs.
- [Seed Agents](./agent.md), what the app environment runs. <!-- id:rXMWvQ23 -->
- [Building on Hypermedia](./build.md), for using these programs from your own code. <!-- id:c6L_X3Dv -->
- [Seed API](./build/web-api.md), the API most of these programs speak. <!-- id:ASzcRpeV -->
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
