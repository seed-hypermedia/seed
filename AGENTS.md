# Agent Guidelines

## Usage Model

- Read subtree `AGENTS.md` files only when writing files in their scope, or when local behavior is unclear or confusing.
- Read `AGENTS.local.md` files if they exist. These are local instructions not checked into the repo. They have
  precedence over other instructions.

## Primary Docs

Documentation lives in `hypermedia/`. Update relevant docs when behavior or interfaces change.

**Production documentation is release-derived.** The content of the `hyper.media` documentation space
(`hm://z6MkfzKMhF9k1oPaQsShWAg8xJzbWf5kaZgn1MkeZvhcAsmB`) comes exclusively from the `hypermedia/` Markdown and schema
files in a Seed release. Never create, update, delete, import, or directly publish documents in this space through the
CLI, SDK, agents, UI, or a local `hypermedia:push`. A locally available signing key is not authorization. Edit the
repository files and ship them through the tagged release's documentation workflow. Requests to define a type at
`hyper.media/<path>` mean adding its source files for a future release, not publishing that URL immediately. Use the
isolated dev documentation space for previews. This rule concerns the documentation space, not unrelated users'
resources served through the `hyper.media` gateway. A user-directed incident rollback is limited to undoing the
identified unauthorized publications; it is not permission for subsequent direct edits.

## Subtree AGENTS.md Map

- `backend/AGENTS.md` for `backend/**`.
- `backend/storage/AGENTS.md` for `backend/storage/**`.
- `frontend/AGENTS.md` for `frontend/**`.
- `proto/AGENTS.md` for `proto/**`.
- `vault/AGENTS.md` for `vault/**`.
- `agents/AGENTS.md` for `agents/**`.

## Agent Assets

- Keep durable repo instructions in `AGENTS.md` and subtree `AGENTS.md` files.
- Keep reusable workflows and task-specific expertise in repo-local `.agents/skills/` so they can be shared by the team.
- Keep provider-specific folders such as `.cursor/` and `.codex/` as thin adapters only; do not duplicate canonical
  instructions there.
- Do not rely on personal home-directory skills such as `~/.agents/skills` for team workflows.

## Repo Rules

- Use `pnpm` for the JavaScript/TypeScript workspace; `agents/**` and `vault/**` use Bun. Follow package scripts.
- Code inside `ops/**` uses a pinned Bun version (see `ops/package.json` `engines.bun`). Always build
  `ops/dist/deploy.js` with that exact version (`bunx --bun bun@<version> build ...`) or CI will fail the staleness
  check.
- Code under `backend/util/llama-go/llama.cpp` is vendored third-party code. Don't touch unless explicitly asked.
- Never modify Git internals directly. Run state-changing Git commands only when explicitly asked.
- Commit messages should explain why the change was made.

## Workflow

- To cut a release, follow `hypermedia/build/releasing.md` (interactive runbook: `.agents/skills/run-release`).
- Use OS temp dir for scratch files. Clean up after you're done.
- This repo uses `mise` + `direnv` for toolchain setup. Run repository commands as `direnv exec . <command>`.
- If direnv blocks the environment, inspect `.envrc` and its referenced repository bootstrap tasks, then run
  `direnv allow .` yourself as ordinary setup, without asking for a new user confirmation.
- `mise.toml` is the source of truth for global toolchain versions. Declare tools not already managed by a dependency
  manager (such as pnpm, Bun, or Go modules) there with explicit, pinned versions. When adding or updating a toolchain,
  start with `mise.toml`, then pin the same exact version in CI, Dockerfiles, and other consumers that do not use mise;
  do not use floating versions in those consumers.

## Required checks before completion

- For changes affecting the pnpm JavaScript/TypeScript workspace, its dependencies, build configuration, or shared
  interfaces, run all of these commands from the repository root before reporting the task complete:
  `direnv exec . sh -c 'pnpm typecheck && pnpm test && pnpm format:write && pnpm audit'`
- Run these checks after the final change, not on every turn or after every intermediate edit. Targeted package checks
  are useful during iteration but do not replace this final workflow for changes in scope.
- All four commands must pass. If a command fails, correct the cause and run the required checks again.
- Review changes made by `pnpm format:write`. If it changes code, run typecheck and tests again against the final files.
- Do not skip applicable checks just because a change appears small.
- Unrelated Go-only or documentation-only changes do not require the pnpm workflow. Run checks relevant to the affected
  area instead, including formatting and any relevant documentation link/schema checks.
- Before committing, check formatting of touched files with the appropriate formatter (for example, `gofmt` for Go and
  Prettier for supported JavaScript/TypeScript/Markdown files).
- If a check cannot run or a failure remains unresolved, report the command, the cause, and the task as incomplete. Do
  not claim that all checks passed.
- Include the check results in the final response.
- These checks are required in addition to checks specified by subtree instructions.

## Local CI

- Validate changes with [agent-ci](https://agent-ci.dev) before pushing. Full guide: `hypermedia/build/local-ci.md`.
- Select workflows relevant to the change; commands, setup, and platform limitations are in the runbook.
- Use `-p` (`--pause-on-failure`). On failure, fix in place and run `npx @redwoodjs/agent-ci retry --name <runner-name>`
  rather than starting a fresh runner.
- Avoid `--all` and `dev-docker-images.yml` for routine work — they include heavy llama.cpp Vulkan builds and Docker
  image assembly without extra signal beyond `test-go.yml`.

## Coding Guidelines

- Normalize, trim, canonicalize, or otherwise clean input at system boundaries only (HTTP handlers, CLI parsing, config
  loading, deserialization edges). Do not repeat defensive string normalization in deeper internal functions; internal
  APIs should receive already-normalized values and compare them exactly unless the domain explicitly requires
  otherwise.
- Follow nearby patterns. Add helpers or files when they improve ownership, reuse, or clarity, not for speculative
  abstraction or defensive handling of impossible internal states.
- Never fix race conditions with sleeps and timeouts, unless there's absolutely no other way. In this case, always ask
  the user for permission first.
- Document exported symbols.
- Test observable behavior; use real dependencies unless impractical or unsafe. Bug fixes should have regression
  coverage where practical.
- When writing Tailwind:
  - Prefer built-in utilities and consistent spacing scales; use arbitrary values only when needed.
  - Use parent `gap` for flex/grid spacing instead of child margins when possible.
