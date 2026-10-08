# Seed Hypermedia CLI

`seed-cli` reads and writes the Hypermedia network from a terminal: documents, comments, contacts, capabilities, keys,
and whole spaces as folders of markdown. It signs locally with an Ed25519 key you hold and talks to any Seed site over
HTTPS. It needs no daemon of its own.

**Package:** `@seed-hypermedia/cli` **License:** MIT **Requires:** Node.js >= 18. The package provides two identical
binaries, `seed-cli` and `seed-hypermedia`.

## Install

```bash
npx -y @seed-hypermedia/cli --help      # run without installing
npm install -g @seed-hypermedia/cli     # or install
```

## Quick start

```bash
seed-cli key generate -n main --show-mnemonic            # a key in the OS keyring; keep the words
seed-cli document create -f note.md -p notes/first       # publish a markdown file into your own space
seed-cli document get hm://<your-account>/notes/first    # read it back as markdown with block ids
seed-cli document update hm://<your-account>/notes/first -f note.md   # publish only the changed blocks
seed-cli search "first note"
seed-cli key list                                        # keys in the Seed app's vault and in the keyring
```

Every write takes `-k <key>`; without it the default key signs. Writing into a space you do not own takes
`-a <uid>` and a capability from its owner. `seed-cli <group> --help` lists a group's subcommands.

## Documentation

The reference lives in the Seed docs, published from the `hypermedia/` folder of this repository:

- [CLI reference](https://github.com/seed-hypermedia/seed/blob/main/hypermedia/build/cli.md): every command, flag,
  environment variable, and the output conventions
- [Keys](https://github.com/seed-hypermedia/seed/blob/main/hypermedia/build/keys.md): the vault, the keyring, `.hmkey.json`
  files, headless machines and bot keys
- [Publish a folder](https://github.com/seed-hypermedia/seed/blob/main/hypermedia/build/publish-a-folder.md): the `space`
  commands and the lossless markdown dialect
- [Seed API](https://github.com/seed-hypermedia/seed/blob/main/hypermedia/build/web-api.md) and
  [SDK](https://github.com/seed-hypermedia/seed/blob/main/hypermedia/build/sdk.md): what the CLI calls and builds on
- [The Seed CLI](https://github.com/seed-hypermedia/seed/blob/main/hypermedia/apps/cli.md): the contributor's map of this
  package

## Development

```bash
cd frontend/apps/cli
bun run src/index.ts --help   # run from source
pnpm build                    # bundle into dist/ for Node
pnpm typecheck
pnpm test                     # fixture suite against a real daemon and web server
pnpm test:unit                # unit tests
```

From the repository root, `./dev install-cli` builds the CLI and links it into `~/.local/bin`. Releases are automatic:
the `publish-client` workflow publishes a new patch version to npm when the CLI's sources change on `main`, so the
version in `package.json` is not the published version.
