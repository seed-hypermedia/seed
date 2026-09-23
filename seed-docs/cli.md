---
name: CLI
summary: The seed-cli commands that publish this folder, and how the repository uses them.
---
The Seed CLI lives at `frontend/apps/cli` and runs from source with `bun run src/index.ts`. The commands below are the ones this folder is published with. <!-- id:47mO4k3w -->

# space export <!-- id:4QUvGBIe -->

```sh <!-- id:v2HrI1rl -->
seed-cli space export hm://<uid> --dir ./seed-docs
```

Writes every document of the space into the directory as lossless markdown. Use it to bring edits made in the Seed app back into git. <!-- id:62qUBdQy -->

# space import <!-- id:SrJNXMw4 -->

```sh <!-- id:_kBk-bfv -->
seed-cli space import hm://<uid> --dir ./seed-docs --dry-run
seed-cli space import self --dir ./seed-docs
```

Publishes the directory into the space, updating existing documents block by block. `self` means the signing key's own space. The signing key comes from the vault or keyring, or from the environment, which is how CI signs: `SEED_CLI_KEYFILE` holds the contents of an unencrypted `.hmkey.json` exported from the app, or `SEED_CLI_MNEMONIC` holds a BIP-39 phrase. <!-- id:zcB4OI7D -->

# space dev <!-- id:dpshaoY4 -->

```sh <!-- id:cOirXqpn -->
seed-cli space dev --dir ./seed-docs
```

Edit the directory in the desktop dev app. See [Repo HM sync](./repo-hm-sync.md). <!-- id:K0HAprxr -->

# In this repository <!-- id:S9sJBMK0 -->

- `./dev hm-sync` runs the editing loop for `seed-docs/` (`./dev hm-sync <dir>` for any other folder). <!-- id:fdA1E3H4 -->
- `pnpm docs:push` publishes `seed-docs/` to hyper.media with your key. <!-- id:SU-YBU1V -->
- `pnpm docs:pull` writes the published site back into `seed-docs/`. <!-- id:AFS_mXqg -->
- A commit to `main` that touches `seed-docs/` publishes it from CI. <!-- id:QkZSrmRL -->
