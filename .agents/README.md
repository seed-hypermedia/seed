# Agent assets

This directory is the repo-local, provider-neutral home for reusable agent assets. Commit content here when teammates
should share it.

- `skills/` contains Open Agent Skills (`SKILL.md`) for reusable workflows and task-specific expertise.
- Root and subtree `AGENTS.md` files remain the canonical durable instructions for repo rules, commands, and coding
  conventions.
- Provider-specific folders such as `.cursor/` and `.codex/` should stay thin adapters that point back to `AGENTS.md`
  and `.agents/skills/`. Codex reads `AGENTS.md` and `.agents/skills/` natively (`.codex/environments/environment.toml`
  is its environment setup); Cursor reads `.cursor/`; Zed and Ollama-backed harnesses are configured to read `AGENTS.md`
  and attach the relevant `.agents/skills/*/SKILL.md`.
- `security/` holds the vulnerability-hunting protocol (`auditor.md`), its audit log, and the probe scripts.
- Do not add canonical instructions to a provider folder when they apply to every agent, and do not duplicate a workflow
  across provider folders: create or update a skill under `skills/` instead.

Do not depend on personal home-directory skills such as `~/.agents/skills` for team workflows.
