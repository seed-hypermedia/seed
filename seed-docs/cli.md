---
name: CLI
summary: The seed-cli commands that publish this folder, and how the repository uses them.
---
The Seed CLI lives at `frontend/apps/cli` and runs from source with `bun run src/index.ts`. The commands below are the ones this folder is published with.

# space export

```sh
seed-cli space export hm://<uid> --dir ./seed-docs
```

Writes every document of the space into the directory as lossless markdown. Use it to bring edits made in the Seed app back into git.

# space import

```sh
seed-cli space import hm://<uid> --dir ./seed-docs --dry-run
seed-cli space import self --dir ./seed-docs
```

Publishes the directory into the space, updating existing documents block by block. `self` means the signing key's own space. The signing key comes from the vault or keyring, or from the `SEED_CLI_MNEMONIC` environment variable, which is how CI signs.

# space dev

```sh
seed-cli space dev --dir ./seed-docs
```

Edit the directory in the desktop dev app. See [Repo HM sync](./repo-hm-sync.md).

# In this repository

- `./dev hm-sync` runs the editing loop for `seed-docs/` (`./dev hm-sync <dir>` for any other folder).
- `pnpm docs:push` publishes `seed-docs/` to hyper.media with your key.
- `pnpm docs:pull` writes the published site back into `seed-docs/`.
- A commit to `main` that touches `seed-docs/` publishes it from CI.
