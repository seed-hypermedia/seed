---
name: CLI
summary: The seed-cli commands that publish this folder, and how the repository uses them.
---
The Seed CLI lives at `frontend/apps/cli` and runs from source with `bun run src/index.ts`. The commands below are the ones this folder is published with; `sync-hypermedia.ts` wraps them with this folder's layout (`onyx-<x>.md` publishes at `/<x>`, `README.md` stays on GitHub). <!-- id:47mO4k3w -->

# space export <!-- id:4QUvGBIe -->

```sh <!-- id:v2HrI1rl -->
seed-cli space export hm://<uid> --dir ./hypermedia
```

Writes every document of the space into the directory as lossless markdown. Use it to bring edits made in the Seed app back into git. <!-- id:62qUBdQy -->

# space import <!-- id:SrJNXMw4 -->

```sh <!-- id:_kBk-bfv -->
seed-cli space import hm://<uid> --dir ./hypermedia --dry-run
seed-cli space import self --dir ./hypermedia
```

Publishes the directory into the space, updating existing documents block by block. `self` means the signing key's own space. The signing key comes from the vault or keyring, or from the `SEED_CLI_MNEMONIC` environment variable, which is how CI signs. <!-- id:zcB4OI7D -->

# space dev <!-- id:dpshaoY4 -->

```sh <!-- id:cOirXqpn -->
seed-cli space dev --dir ./hypermedia
```

Edit the directory in the desktop dev app. See [Repo HM sync](./repo-hm-sync.md). <!-- id:K0HAprxr -->

# In this repository <!-- id:S9sJBMK0 -->

- `./dev hm-sync` runs the editing loop for `hypermedia/` (`./dev hm-sync <dir>` for any other folder); `./dev up` runs it as the `hm-sync` pane. <!-- id:fdA1E3H4 -->
- `pnpm hypermedia:push` publishes `hypermedia/` to the Onyx site on hyper.media with the `main` key (`--dry-run` to preview). <!-- id:SU-YBU1V -->
- `pnpm hypermedia:pull` writes the published site back into `hypermedia/`. <!-- id:AFS_mXqg -->
- A commit to `main` that touches `hypermedia/` publishes it from CI. <!-- id:QkZSrmRL -->
