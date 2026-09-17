---
name: The Seed CLI
summary: Where the seed-cli code lives, how it reaches a site or a local desktop app, where it keeps its keys and settings, and how it is built and released.
---
The Seed CLI, `seed-cli`, is the terminal client for the Hypermedia network. It reads and writes [documents](../protocol/documents.md), [comments](../protocol/comments.md), contacts, [capabilities](../protocol/permissions.md) and keys, converts documents to and from markdown, and publishes whole folders, including this documentation. It needs no [daemon](./daemon.md) of its own: it signs locally and talks to a [site](../protocol/sites.md) over HTTPS. This page is the contributor's map; every command and flag is in the [CLI reference](../build/cli.md). <!-- id:_Xplw73v -->

# Where the code is <!-- id:FOyxcRRf -->

`frontend/apps/cli`, package `@seed-hypermedia/cli`, published to npm with two binaries, `seed-cli` and `seed-hypermedia`. It is written in TypeScript on [commander](https://github.com/tj/commander.js), developed and tested with Bun, and bundled with `bun build --target node` into `dist/index.js`, so the published package runs on plain Node. <!-- id:c5DHHq6J -->

<!-- id:IiBkStda -->
| Path <!-- col:AizohveC --> | What it holds <!-- col:Xg5M8sRT --> <!-- id:wcfSByAv --> |
| --- | --- |
| `src/index.ts` | The entry point: global options, server resolution, command registration. <!-- id:NhMRdIGL --> |
| `src/commands/` | One file per command group: `document`, `comment`, `capability`, `contact`, `account`, `key`, `draft`, `space`, `blob`, `schema`, `search`, `query`. <!-- id:hXbZz9Z9 --> |
| `src/utils/keyring.ts`, `src/utils/keys.ts` | Key lookup across the OS keyring, the [desktop app](./desktop.md)'s [vault](./vault.md) file and environment variables. <!-- id:RWM3dvGr --> |
| `src/sync-hypermedia.ts` | The push, pull and dev loop for this `hypermedia/` folder. <!-- id:oJVT-zrR --> |
| `src/test/` | The fixture suite that starts a real [daemon](./daemon.md) and web server. <!-- id:hmbA1t-D --> |

The CLI builds and signs [blobs](../protocol/blobs.md) with `@seed-hypermedia/client`, [the SDK](../build/sdk.md). A few files, the folder sync among them, also import from `@shm/shared` without declaring it; they work inside the monorepo and are bundled into the published build. <!-- id:aDUqe6BA -->

# How it talks to the network <!-- id:JjcUsDL6 -->

By default every command goes to `https://hyper.media`. The server is chosen in this order: `--dev` (which means `https://dev.hyper.media` and the dev keyring), `--server <url>`, the `SEED_SERVER` environment variable, the `server` value in `~/.seed/config.json`, and finally hyper.media. Reads are GET requests to the [site](../protocol/sites.md)'s `/api/<Key>` routes; writes are signed [blobs](../protocol/blobs.md) sent with the `PublishBlobs` action. See [The web API](../build/web-api.md). <!-- id:3jCFyenv -->

`seed-cli space dev` is the one mode that talks to a local node. It publishes a folder into the running [desktop app](./desktop.md) through the app's API bridge, `http://localhost:58004` by default, and watches the [daemon](./daemon.md) at `http://localhost:58001`, writing edits made in the app back to disk. `./dev hm-sync` runs that loop for this folder. <!-- id:3F7HcmWK -->

# Keys and configuration <!-- id:FVefTboF -->

<!-- id:oCyJkKqh -->
| Source <!-- col:CIe5DCmw --> | Meaning <!-- col:jPgscKOt --> <!-- id:9P7zRRMV --> |
| --- | --- |
| OS keyring | Service `seed-daemon-main`, or `seed-daemon-dev` with `--dev`: the same entries the [desktop app](./desktop.md)'s [daemon](./daemon.md) uses. <!-- id:O-DhTtER --> |
| Desktop [vault](./vault.md) file | The desktop app's `vault.json`, found automatically or named with `--vault` or `vaultPath` in the config; searched before the keyring. <!-- id:LJdGm6md --> |
| `SEED_CLI_KEYFILE`, `SEED_CLI_MNEMONIC` | A key for CI or a server, as an unencrypted `.hmkey.json` or a BIP-39 phrase. Only one may be set. <!-- id:SNkhHOfT --> |
| `~/.seed/config.json` | Saved settings such as `server` and `vaultPath`. <!-- id:t3MOiUVR --> |

[Keys](../build/keys.md) explains how to create, import and delegate keys. <!-- id:DnXCnmjG -->

# Build, test, release <!-- id:rdVstE7F -->

```sh <!-- id:42w0sgFF -->
cd frontend/apps/cli
bun run src/index.ts --help   # run from source
pnpm build                    # bundle into dist/
pnpm test                     # fixture suite against a real daemon and web server
pnpm test:unit                # fast unit tests
```

Releases are automatic: the `publish-client.yml` workflow builds and publishes the CLI and the [SDK](../build/sdk.md) to npm when their sources change on `main`. The version in the repository's `package.json` is not the published version, so check npm for what users have. <!-- id:CPwMNy7U -->

# Working with it <!-- id:xrvWXm0_ -->

## In the Seed app <!-- id:CF6WBuze -->

The CLI reads the same keyring entries and [vault](./vault.md) file as the [desktop app](./desktop.md), so an [account](../protocol/identity.md) created in the app is usable from the terminal on the same machine. <!-- id:GNFr4u2A -->

## Agents <!-- id:ACF4c6ly -->

A coding agent such as Claude Code with the seed-cli skill drives Hypermedia through these commands; [Building agents on Seed](../build/agents.md) shows how. [Seed Agents](../agent.md) do not use the CLI; they call the [Seed API](../build/web-api.md) directly. <!-- id:j7yozfyO -->

# See also <!-- id:nOm7MljI -->

- [CLI reference](../build/cli.md), [Keys](../build/keys.md), [Publish a folder](../build/publish-a-folder.md) <!-- id:1y732BFM -->
- [The web app](./web.md), [The desktop app](./desktop.md) <!-- id:1Mor504j -->
