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
- Ask clarifying questions when requirements or constraints are ambiguous.
- Never modify the `.git` directory directly.
- Do not run git commands that write state, including commit, amend, rebase, reset, checkout, merge, cherry-pick, stash, tag, branch deletion, or push, unless explicitly asked.
- Do not edit vendored code under `backend/util/llama-go/llama.cpp` unless explicitly asked.
- Use pnpm workflows for the main repository, and Bun workflows for `vault/**`.
- Run relevant tests, type checks, and linters for touched areas before finishing.
- Use `.local/` for temporary plans and scratch files.
