# Repository Guidelines

## Project Structure & Module Organization

- `backend/` hosts Go services (daemon, APIs, P2P); Bazel/Please targets exist, but day-to-day builds rely on `go` tooling and the `./dev` wrapper.
- `frontend/` contains all the typescript code for web and desktop platforms.
- `frontend/apps/` contains Remix- and Electron-based apps; shared React utilities live under `frontend/packages/`.
- `docs/` stores developer playbooks and design notes.
- `proto/` holds the canonical protocol buffers; scripts and automation live in `scripts/`.
- `.local/` directory is a gitignored scratchpad directory for any files you might want to keep around. Use this for storing plans files, todos, memory, and anything useful. You can list and modify files in this directory as usual, despite it being gitignored.
- Tests follow source: Go `_test.go` files sit beside implementations, while web specs live in `__tests__` or `*.test.ts[x]` folders within each workspace.

## Commit & Pull Request Guidelines

- Follow the prevailing short, imperative style (`fix(frontend/web): adjust toast layout`) — we try to follow the Conventional Commits format for commit messages.
- Group fixups locally with `git commit --fixup` and squash before merge.
- Reference issue IDs or Linear tasks in the body when relevant, and note user-facing impacts.
- PRs should describe the change, list manual verification steps, and include UI screenshots for visual tweaks.

## Environment Setup Notes

- macOS/Linux contributors rely on Nix + Direnv; run `direnv allow` after cloning to sync toolchains.
- The `docs/docs/dev-setup.md` guide stays authoritative—update it whenever tooling or bootstrapping steps change.

## Further Instructions

Always try see if there's a an additional `AGENTS.md` file near the files you're working with. It can be anywhere up the directory tree.

- For backend-related tasks, refer to @backend/AGENTS.md.
- For frontend-related tasks, refer to @frontend/AGENTS.md.
- For protobuf-related tasks, refer to @proto/AGENTS.md.

There may be additional `AGENTS.md` files in other directories, this list is not exhaustive.
