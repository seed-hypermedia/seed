# Agent assets

This directory is the repo-local, provider-neutral home for reusable agent assets. Commit content here when teammates
should share it.

- `skills/` contains Open Agent Skills (`SKILL.md`) for reusable workflows and task-specific expertise.
- Root and subtree `AGENTS.md` files remain the canonical durable instructions for repo rules, commands, and coding
  conventions.
- Provider-specific folders such as `.cursor/` and `.codex/` should stay thin adapters that point back to `AGENTS.md`
  and `.agents/skills/`.

Do not depend on personal home-directory skills such as `~/.agents/skills` for team workflows.
