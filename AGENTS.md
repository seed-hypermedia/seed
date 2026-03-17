# Agent Guidelines

## Usage model

- Read this file first.
- Read subtree `AGENTS.md` files only when writing files in their scope, or when local behavior is unclear or confusing.

## Subtree AGENTS map

- `backend/AGENTS.md` for `backend/**`.
- `backend/storage/AGENTS.md` for `backend/storage/**`.
- `frontend/AGENTS.md` for `frontend/**`.
- `proto/AGENTS.md` for `proto/**`.
- `vault/AGENTS.md` for `vault/**`.

## Global rules

- Keep changes minimal and consistent with nearby code.
- Prefer existing files over creating tiny one-off modules. Add a new file only when it materially improves structure,
  ownership, or reuse.
- Before making any changes or plans, Ask clarifying questions when requirements or constraints are ambiguous until you
  are 95% sure what needs to be done
- Never modify the `.git` directory directly.
- Do not run git commands that write state, including commit, amend, rebase, reset, checkout, merge, cherry-pick, stash,
  tag, branch deletion, or push, unless explicitly asked.
- Do not edit vendored code under `backend/util/llama-go/llama.cpp` unless explicitly asked.
- Use pnpm workflows for the main repository, and Bun workflows for `vault/**`.
- Never run `pnpm install` from the sandbox. Don't try to work around it, run it from the normal command line, and ask
  permissions if you can't do it directly.
- Run relevant tests, type checks, and linters for touched areas before finishing.
- Use OS temp directory for scratch files and other temporary files you need to create.
- Write doc comments on every exported symbol. Even trivial ones.
- Avoid banner-style comments splitting the file into sections — they are often forgotten when code is moved around.
- Write tests. Prefer broader tests that exercise real functionality and public interfaces over minutiae and excessive
  mocking. Avoid useless tests that give false confidence.
- Avoid writing tiny helper functions, especially if they are not used elsewhere. Colocate related code for better
  comprehension.
