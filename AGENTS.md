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

- macOS/Linux contributors rely on Mise + Direnv; run `direnv allow` after cloning to sync toolchains.
- The `docs/docs/dev-setup.md` guide stays authoritative—update it whenever tooling or bootstrapping steps change.

## Extra Rules

Always read `AGENTS.md` file near the files you're working with. It can be anywhere up the directory tree.

Here's a non-exhaustive list of extra rule files. Read them in full when working on files in those subtrees, but don't bother reading them if you're not:

- `backend/**` — @backend/AGENTS.md.
- `backend/storage/**` — @backend/storage/AGENTS.md.
- `frontend/**` — @frontend/AGENTS.md.
- `proto/**` — @proto/AGENTS.md.

When you learn any new context that is generalized enough to be useful in the future for you, suggest updates to this or others AGENTS.md files.
