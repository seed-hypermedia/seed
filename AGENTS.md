# Agent Guidelines

## Usage Model

- Read this file first.
- Read subtree `AGENTS.md` files only when writing files in their scope, or when local behavior is unclear or confusing.

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

## Coding Guidelines

- Keep changes minimal and consistent with nearby code.
- Prefer existing files over creating new tiny one-off modules. Add a new file only when it materially improves
  structure, ownership, or reuse.
- Avoid writing tiny helper functions, especially if they are not used elsewhere. Colocate related code for better
  comprehension. Think twice before leaving one-liner functions.
- Think twice before doing any "defense-in-depth" coding, to avoid it ending up being totally unreasonable.
- Never fix race conditions with sleeps and timeouts, unless there's absolutely no other way. In this case, always ask
  the user for permission first.
- Write doc comments on every exported symbol. Even trivial ones.
- Avoid banner-style comments splitting the file into sections — they are often forgotten when code is moved around.
- Write tests! Prefer broader tests that exercise real functionality and public interfaces over minutiae and excessive
  mocking. Avoid useless tests that give false confidence. Don't get too crazy though.
- When writing Tailwind:
  - Prefer built-in utilities over arbitrary values.
  - Use arbitrary values only when standard Tailwind classes cannot reasonably express the requirement.
  - Prefer layout scales that follow a consistent rhythm.
  - Do not use random pixel values for spacing or sizing.
  - Use parent `gap` for flex/grid spacing instead of child margins when possible.
- Run relevant tests, type checks, and linters for touched areas before finishing.
