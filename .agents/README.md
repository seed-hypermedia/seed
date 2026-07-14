# Agent assets

This directory is the repo-local, provider-neutral home for reusable agent assets. Commit content here when teammates
should share it.

- `skills/` contains Open Agent Skills (`SKILL.md`) for reusable workflows and task-specific expertise.
- Root and subtree `AGENTS.md` files remain the canonical durable instructions for repo rules, commands, and coding
  conventions.
- Provider-specific folders such as `.cursor/` and `.codex/` should stay thin adapters that point back to `AGENTS.md`
  and `.agents/skills/`.

Do not depend on personal home-directory skills such as `~/.agents/skills` for team workflows.

Keep a skill only when it contributes non-obvious project knowledge, a repeatable workflow, a tool protocol, or a
stable output contract. Generic role prompts and ordinary engineering advice belong in neither skills nor adapters.
Keep `SKILL.md` concise, move task-specific detail into references loaded on demand, and avoid duplicating canonical
repository rules from `AGENTS.md`.
