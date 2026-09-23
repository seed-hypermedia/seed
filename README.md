# Seed

Seed is open-source software for the [Hypermedia protocol](https://hyper.media): a network of signed, versioned
documents and comments that anyone can publish, link, archive and collaborate on without a central server.

This repository holds all of it:

- the Seed daemon (`backend/`), a Go peer-to-peer node that stores, indexes and syncs Hypermedia data
- the Seed desktop app and the Seed web app (`frontend/apps/desktop`, `frontend/apps/web`)
- the Seed CLI and the SDK, `@seed-hypermedia/client` (`frontend/apps/cli`, `frontend/packages/client`)
- Seed Agents (`agents/`), the identity vault (`vault/`) and the notification service (`frontend/apps/notify`)
- the developer documentation and the Hypermedia Schemas library (`hypermedia/`)

## Documentation

The developer docs live in [`hypermedia/`](./hypermedia/index.md) and are published to the Hypermedia network from this
repository. Start with:

- [The Hypermedia protocol](./hypermedia/protocol.md)
- [Building on Hypermedia](./hypermedia/build.md): the Seed API, the SDK, the CLI and agents
- [Contributing](./hypermedia/build/contributing.md): the repository map, dev setup, tests and releases

## Stability

The permanent data format is stable. The APIs, the SDK and the CLI still change. Keep your own copy of anything valuable
you put into the app.

## Development

The toolchain is pinned in `mise.toml` and activated by [direnv](https://direnv.net). Install
[mise](https://mise.jdx.dev) and direnv, then:

```sh
direnv allow
pnpm install
```

[`./dev`](./dev) is the dev CLI. Run `./dev` to list every command. The common ones:

- `./dev up` runs the whole stack on mainnet in one mprocs window (see `mprocs.yaml`)
- `./dev up-testnet` runs the same stack on the dev testnet
- `./dev run-desktop` runs the desktop app with its own daemon
- `./dev run-web` runs the web app
- `./dev run-backend` builds and runs the daemon
- `./dev gen` checks and regenerates generated code
- `./dev hm-sync` edits `hypermedia/` in the desktop dev app

Before a pull request:

```sh
pnpm typecheck
pnpm format:check
pnpm test
```

See [Contributing](./hypermedia/build/contributing.md) for Go tests, integration tests, migrations, protobuf generation,
self-hosting and releasing.
