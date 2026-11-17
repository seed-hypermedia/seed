---
name: The Seed CLI
summary: Where the seed-cli code lives, how it reaches a site or a local desktop app, where it keeps its keys and settings, and how it is built and released.
---
The Seed CLI, `seed-cli`, is the terminal client for the Hypermedia network. It reads and writes [documents](../protocol/documents.md), [comments](../protocol/comments.md), [contacts](../protocol/contacts.md), [capabilities](../protocol/permissions.md) and [keys](../build/keys.md), converts documents to and from markdown, and [publishes whole folders](../build/publish-a-folder.md), including this documentation. It needs no [daemon](./daemon.md) of its own. It signs locally and talks to a [site](../protocol/sites.md) over HTTPS. This page is the contributor's map. Every command and flag is in the [CLI reference](../build/cli.md). <!-- id:_Xplw73v -->

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

The CLI builds and signs [blobs](../protocol/blobs.md) with `@seed-hypermedia/client`, [the SDK](../build/sdk.md). A few files, the folder sync among them, also import from `@shm/shared` without declaring it. They work inside the monorepo, and the published build bundles them. <!-- id:aDUqe6BA -->

# How it talks to the daemon <!-- id:JjcUsDL6 -->

It does not need one. Every command goes to a [site](../protocol/sites.md): reads are GET requests to the site's `/api/<Key>` routes, and writes are signed [blobs](../protocol/blobs.md) sent with the `PublishBlobs` action. See [The web API](../build/web-api.md). Which site is resolved in `src/index.ts`; the order of the flags, the variable and the config file is in the [CLI reference](../build/cli.md). <!-- id:3jCFyenv -->

`seed-cli space dev` is the one mode that talks to a local node. It publishes a folder into the running [desktop app](./desktop.md) through the app's API bridge, `http://localhost:58004` by default, and watches the [daemon](./daemon.md) at `http://localhost:58001`, writing edits made in the app back to disk. `./dev hm-sync` runs that loop for this folder. <!-- id:3F7HcmWK -->

# Configuration <!-- id:FVefTboF -->

The CLI has three sources of settings: global flags, environment variables, and `~/.seed/config.json`. The [CLI reference](../build/cli.md) lists them all. Signing keys come from the environment, the desktop app's `vault.json`, or the OS keyring; the lookup is in `src/utils/keyring.ts` and `src/utils/keys.ts`, and [Keys](../build/keys.md) explains each store and how to create, import and delegate keys. <!-- id:DnXCnmjG -->

# Running it <!-- id:rdVstE7F -->

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

A coding agent such as Claude Code with the seed-cli skill drives Hypermedia through these commands; [Using Seed from your own agent](../build/agents.md) shows how. [Seed Agents](../agent.md) do not use the CLI. They call the [Seed API](../build/web-api.md) directly. <!-- id:j7yozfyO -->

# See also <!-- id:nOm7MljI -->

- [CLI reference](../build/cli.md), [Keys](../build/keys.md), [Publish a folder](../build/publish-a-folder.md) <!-- id:1y732BFM -->
- [The web app](./web.md), [The desktop app](./desktop.md), [Using Seed from your own agent](../build/agents.md) <!-- id:1Mor504j -->
