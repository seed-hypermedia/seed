# Agent setup

This repo keeps shared agent instructions in provider-neutral files so teammates can use Codex, Cursor, Zed,
Ollama-backed harnesses, or other coding agents without duplicating rules.

## Canonical files

- `AGENTS.md` is the source of truth for repo-wide instructions.
- Subtree `AGENTS.md` files apply to their directories. See the routing table in the root `AGENTS.md`.
- `.agents/skills/` contains shared reusable workflows and task-specific expertise.

## Provider-specific adapters

- Codex: reads `AGENTS.md` and repo-local `.agents/skills/`; `.codex/environments/environment.toml` is kept for Codex
  environment setup.
- Cursor: `.cursor/` is a thin adapter. It should point back to `AGENTS.md` and use repo commands from the AGENTS files.
- Zed and Ollama-backed harnesses: configure the harness to read `AGENTS.md`; attach or reference relevant
  `.agents/skills/*/SKILL.md` files when a task matches a skill.

## What not to do

- Do not add new canonical instructions to provider-specific folders if they apply to every agent. Put them in
  `AGENTS.md` or a subtree `AGENTS.md`.
- Do not rely on personal home-directory skills such as `~/.agents/skills` for team workflows. Use repo-local
  `.agents/skills/`.
- Do not duplicate the same workflow in multiple provider folders. Create or update a skill under `.agents/skills/`
  instead.
