# Agent Guidelines

## Usage Model

- Read this file first.
- Read subtree `AGENTS.md` files only when writing files in their scope, or when local behavior is unclear or confusing.
- Read `AGENTS.local.md` files if they exist. These are local instructions not checked into the repo. They have
  precedence over other instructions.

## Subtree AGENTS.md Map

- `backend/AGENTS.md` for `backend/**`.
- `backend/storage/AGENTS.md` for `backend/storage/**`.
- `frontend/AGENTS.md` for `frontend/**`.
- `proto/AGENTS.md` for `proto/**`.
- `vault/AGENTS.md` for `vault/**`.

## Repo Rules

- Use `pnpm` for main repo, `bun` for `vault/**`.
- Code inside `ops/**` uses a pinned Bun version (see `ops/package.json` `engines.bun`). Always build
  `ops/dist/deploy.js` with that exact version (`bunx --bun bun@<version> build ...`) or CI will fail the staleness
  check.
- Code under `backend/util/llama-go/llama.cpp` is vendored third-party code. Don't touch unless explicitly asked.
- Never modify the `.git` directory directly.
- Do not run git commands that write state, including commit, amend, rebase, reset, checkout, merge, cherry-pick, stash,
  tag, branch deletion, or push, unless explicitly asked.

## Workflow

- Ask clarifying questions when ambiguity matters.
- Use OS temp dir for scratch files. Clean up after you're done.
- Ask for elevated permissions instead of working around sandboxing issues (if you can run in a sandbox).
- When running repo commands in a non-interactive shell, remember that `direnv allow` might not apply to the current
  process. Load the environment explicitly when needed:
  - `eval "$(direnv export zsh)"`

## Local CI

- Validate changes with [agent-ci](https://agent-ci.dev) before pushing. Full guide: `docs/local-ci-with-agent-ci.md`.
- Pick the workflow that matches what you touched (subtree `AGENTS.md` files list the canonical command for each area):
  - Frontend: `npx @redwoodjs/agent-ci run -w .github/workflows/test-frontend-parallel.yml -p --github-token`
  - Backend lint: `npx @redwoodjs/agent-ci run -w .github/workflows/lint-go.yml -p`
  - Backend tests: `npx @redwoodjs/agent-ci run -w .github/workflows/test-go.yml -p`
  - Vault: `npx @redwoodjs/agent-ci run -w .github/workflows/dev-vault-image.yml -p --github-token`
  - Ops deploy script: `npx @redwoodjs/agent-ci run -w .github/workflows/check-deploy-script.yml -p --github-token`
- On failure, fix in place and `npx @redwoodjs/agent-ci retry --name <runner-name>` instead of starting a fresh run. Use
  `npx @redwoodjs/agent-ci abort --name <runner-name>` to give up.
- Avoid `--all` and `dev-docker-images.yml` for routine work — they include heavy llama.cpp Vulkan builds and Docker
  image assembly without extra signal beyond `test-go.yml`.
- Skipped automatically: `windows-*` jobs (unsupported); `macos-*` jobs require `tart` + `sshpass`.

## Coding Guidelines

- Keep changes minimal and consistent with nearby code.
- Normalize, trim, canonicalize, or otherwise clean input at system boundaries only (HTTP handlers, CLI parsing, config
  loading, deserialization edges). Do not repeat defensive string normalization in deeper internal functions; internal
  APIs should receive already-normalized values and compare them exactly unless the domain explicitly requires
  otherwise.
- Prefer existing files over creating new tiny one-off modules. Add a new file only when it materially improves
  structure, ownership, or reuse.
- Avoid writing tiny helper functions, especially if they are not used elsewhere. Colocate related code for better
  comprehension. Think twice before leaving one-liner functions.
- Think twice before doing any "defense-in-depth" coding, to avoid it ending up being totally unreasonable.
- Never fix race conditions with sleeps and timeouts, unless there's absolutely no other way. In this case, always ask
  the user for permission first.
- Write doc comments on every exported symbol. Even trivial ones.
- Avoid banner-style comments splitting the file into sections — they are often forgotten when code is moved around.
- Most code should have tests.
  - Prefer tests that exercise real behavior — avoid mocks unless the real dependency is impractical or unsafe.
  - If the test is full of mocks — think twice whether it's actually useful, or it's just there to give false
    confidence.
- When writing Tailwind:
  - Prefer built-in utilities over arbitrary values.
  - Use arbitrary values only when standard Tailwind classes cannot reasonably express the requirement.
  - Prefer layout scales that follow a consistent rhythm.
  - Do not use random pixel values for spacing or sizing.
  - Use parent `gap` for flex/grid spacing instead of child margins when possible.
- Run relevant tests, type checks, and linters for touched areas before finishing.
